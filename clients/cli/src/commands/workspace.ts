import { lstat, mkdir, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathKey, validateManifest, type ManifestEntry } from '@gigacad/core';
import type { Command } from 'commander';
import type { Api, BranchDetail, BranchView, CommitResult } from '../api.js';
import type { Bind, Runtime } from '../cli.js';
import { machineName } from '../config.js';
import { CliError } from '../errors.js';
import { plural, shortId } from '../output.js';
import { findBranch, findProject, parseProjectRef } from '../resolve.js';
import { cacheFrom, hashFiles, listWorkingFiles, type HashedFile } from '../scan.js';
import { requireSignedIn, type Session } from '../session.js';
import { commitFiles, localChanges, planPull, type LocalChange } from '../sync.js';
import { downloadBlobs, placeDownloads, uploadBlobs, type DownloadTarget } from '../transfer.js';
import {
  absolutePath,
  exists,
  findWorkspace,
  requireWorkspace,
  saveWorkspace,
  tempDir,
  trackedFrom,
  workspacePath,
  type CachedStat,
  type Workspace,
  type WorkspaceState,
} from '../workspace.js';

export function registerWorkspaceCommands(program: Command, bind: Bind): void {
  program
    .command('clone <project> [directory]')
    .description('Download a branch into a new folder and track it there')
    .requiredOption('-b, --branch <name>', 'Branch to clone')
    .addHelpText('after', '\nExample:\n  giga clone alex/robot-arm --branch dev robot-dev')
    .action(bind(clone));

  program
    .command('checkout')
    .description('Take this branch’s write lock for this computer, then pull its latest files')
    .action(bind(checkout));

  program.command('pull').description('Download the branch’s latest commit without losing local changes').action(bind(pull));

  program.command('status').description('Show local changes and the branch’s lock and sync state').action(bind(status));

  program
    .command('mv <source> <destination>')
    .description('Move or rename a file or folder, keeping each file’s identity')
    .action(bind(move));

  program
    .command('checkin')
    .description('Give up this branch’s write lock')
    .option('--force', 'Check in even with uncommitted changes (local files are kept)')
    .action(bind(checkin));

  program
    .command('commit')
    .description('Upload every changed file and record a version on the branch')
    .requiredOption('-m, --message <message>', 'What changed')
    .option('--label <label>', 'Version label, e.g. "rev B"')
    .action(bind(commit));
}

async function workspaceSession(rt: Runtime): Promise<{ workspace: Workspace; session: Session }> {
  const workspace = await requireWorkspace(rt.ctx.cwd);
  return { workspace, session: await rt.session() };
}

/** Scans and hashes the working tree, reusing cached hashes for unchanged files. */
async function scan(workspace: Workspace): Promise<HashedFile[]> {
  const { root, state } = workspace;
  const files = await listWorkingFiles(root, Object.keys(state.tracked));
  return hashFiles(root, files, state.cache);
}

async function isEmptyDirectory(path: string): Promise<boolean | undefined> {
  try {
    return (await readdir(path)).length === 0;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    if (code === 'ENOTDIR') return false;
    throw error;
  }
}

async function statCache(root: string, files: readonly ManifestEntry[]): Promise<Record<string, CachedStat>> {
  const entries = await Promise.all(
    files.map(async (file) => {
      const info = await stat(absolutePath(root, file.path));
      return [file.path, { size: info.size, mtimeMs: info.mtimeMs, blob: file.blob }] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function checkManifest(files: readonly ManifestEntry[]): void {
  const issues = validateManifest(files);
  if (issues.length > 0) {
    throw new CliError('invalid_snapshot', 'The branch contains paths this computer can’t store', { details: issues });
  }
}

async function clone(rt: Runtime, projectInput: string, directory: string | undefined, options: { branch: string }): Promise<void> {
  const { ctx, out } = rt;
  const ref = parseProjectRef(projectInput);
  const checkTarget = async (root: string) => {
    const empty = await isEmptyDirectory(root);
    if (empty === false) {
      throw new CliError('directory_not_empty', `${root} already exists and is not empty`, { hint: 'Clone into a new or empty folder.' });
    }
    const outer = await findWorkspace(dirname(root));
    if (outer) throw new CliError('nested_workspace', `${root} is inside another workspace (${outer.root})`, { hint: 'Clone somewhere else.' });
    return empty;
  };
  if (directory) await checkTarget(resolve(ctx.cwd, directory));

  const session = await rt.session({ ignoreWorkspace: true });
  const project = await findProject(session.api, ref);
  const branch = await findBranch(session.api, project.id, options.branch);
  const detail = await session.api.get<BranchDetail>(`/v1/branches/${branch.id}`);
  checkManifest(detail.files);

  const root = resolve(ctx.cwd, directory ?? project.slug);
  const empty = await checkTarget(root);

  const machine = await machineName(ctx);
  await mkdir(root, { recursive: true });
  try {
    out.progress(`Cloning ${project.ownerHandle}/${project.slug} branch ${branch.name} (${plural(detail.files.length, 'file')})`);
    const targets: DownloadTarget[] = detail.files.map((file) => ({ blob: file.blob, path: file.path, absolutePath: absolutePath(root, file.path) }));
    if (targets.length > 0) {
      const downloaded = await downloadBlobs(session.api, project.id, targets, tempDir(root), out.progress.bind(out));
      await placeDownloads(targets, downloaded);
    }
    await rm(tempDir(root), { recursive: true, force: true });
    const state: WorkspaceState = {
      version: 1,
      apiUrl: session.apiUrl,
      projectId: project.id,
      owner: project.ownerHandle,
      slug: project.slug,
      branchId: branch.id,
      branchName: branch.name,
      machine,
      headCommitId: detail.head.id,
      base: detail.files,
      tracked: trackedFrom(detail.files),
      cache: await statCache(root, detail.files),
    };
    await saveWorkspace(root, state);
  } catch (error) {
    // Leave nothing half-cloned: the folder was new or empty before.
    if (empty === undefined) await rm(root, { recursive: true, force: true });
    else for (const entry of await readdir(root)) await rm(resolve(root, entry), { recursive: true, force: true });
    throw error;
  }

  out.result(
    { directory: root, projectId: project.id, branchId: branch.id, branch: branch.name, headCommitId: detail.head.id, files: detail.files.length },
    [
      `Cloned ${project.ownerHandle}/${project.slug} branch ${branch.name} into ${root} (${plural(detail.files.length, 'file')})`,
      branch.status === 'open' ? 'Next: cd into it and run `giga checkout` before changing files.' : `This branch is ${branch.status}; it is read-only.`,
    ],
  );
}

interface PullSummary {
  readonly headCommitId: string;
  readonly updated: boolean;
  readonly written: readonly string[];
  readonly deleted: readonly string[];
}

/** Moves the workspace to the branch's current head, keeping local edits the branch didn't touch. */
async function syncToHead(rt: Runtime, workspace: Workspace, api: Api): Promise<PullSummary> {
  const { root, state } = workspace;
  const detail = await api.get<BranchDetail>(`/v1/branches/${state.branchId}`);
  if (detail.head.id === state.headCommitId) return { headCommitId: state.headCommitId, updated: false, written: [], deleted: [] };
  checkManifest(detail.files);

  const hashed = await scan(workspace);
  const plan = planPull(state, hashed, detail.files);
  if (plan.conflicts.length > 0) {
    throw new CliError('pull_conflicts', 'Pulling would overwrite local changes, so nothing was changed', {
      details: plan.conflicts.map((conflict) => ({ path: conflict.path, message: conflict.reason })),
      hint: 'Copy your versions of these files out of the workspace and delete them here, run `giga pull`, then copy back what you need and commit.',
    });
  }

  const targets: DownloadTarget[] = plan.writes.map((file) => ({ blob: file.blob, path: file.path, absolutePath: absolutePath(root, file.path) }));
  const downloaded = targets.length > 0 ? await downloadBlobs(api, state.projectId, targets, tempDir(root), rt.out.progress.bind(rt.out)) : new Map();
  for (const path of plan.deletes) {
    await rm(absolutePath(root, path), { force: true });
    await removeEmptyParents(root, path);
  }
  await placeDownloads(targets, downloaded);
  await rm(tempDir(root), { recursive: true, force: true });

  const changedKeys = new Set([...plan.deletes, ...plan.writes.map((file) => file.path)].map(pathKey));
  const keptCache = Object.fromEntries(Object.entries(state.cache).filter(([path]) => !changedKeys.has(pathKey(path))));
  await saveWorkspace(root, {
    ...state,
    headCommitId: detail.head.id,
    base: detail.files,
    tracked: plan.tracked,
    cache: { ...keptCache, ...(await statCache(root, plan.writes)) },
  });
  return { headCommitId: detail.head.id, updated: true, written: plan.writes.map((file) => file.path), deleted: plan.deletes };
}

async function removeEmptyParents(root: string, path: string): Promise<void> {
  const segments = path.split('/').slice(0, -1);
  while (segments.length > 0) {
    const dir = absolutePath(root, segments.join('/'));
    if ((await isEmptyDirectory(dir)) !== true) return;
    await rmdir(dir);
    segments.pop();
  }
}

function describePull(summary: PullSummary): string {
  if (!summary.updated) return 'Already up to date.';
  return `Updated to ${shortId(summary.headCommitId)}: ${plural(summary.written.length, 'file')} written, ${summary.deleted.length} deleted.`;
}

async function checkout(rt: Runtime): Promise<void> {
  const { workspace, session } = await workspaceSession(rt);
  requireSignedIn(session);
  const { state } = workspace;
  // Lock first so nobody can commit between the pull and your first change.
  const branch = await session.api.post<BranchView>(`/v1/branches/${state.branchId}/checkout`, { machine: state.machine });
  const pulled = await syncToHead(rt, workspace, session.api);
  rt.out.result({ branch, pull: pulled }, [`Checked out ${state.branchName} on ${state.machine}.`, describePull(pulled)]);
}

async function pull(rt: Runtime): Promise<void> {
  const { workspace, session } = await workspaceSession(rt);
  const pulled = await syncToHead(rt, workspace, session.api);
  rt.out.result(pulled, describePull(pulled));
}

function describeChange(change: LocalChange): string {
  switch (change.kind) {
    case 'moved':
      return `  moved     ${change.from} -> ${change.path}${change.modified ? ' (modified)' : ''}`;
    default:
      return `  ${change.kind.padEnd(9)} ${change.path}`;
  }
}

async function status(rt: Runtime): Promise<void> {
  const { workspace, session } = await workspaceSession(rt);
  const { state, root } = workspace;
  const hashed = await scan(workspace);
  const changes = localChanges(state, hashed);
  // Remember the hashes so the next scan is fast.
  await saveWorkspace(root, { ...state, cache: cacheFrom(hashed) });

  let remote: BranchView | undefined;
  let remoteError: string | undefined;
  try {
    remote = (await session.api.get<BranchDetail>(`/v1/branches/${state.branchId}`)).branch;
  } catch (error) {
    remoteError = error instanceof Error ? error.message : String(error);
  }
  const lockedHere = remote?.checkedOutBy !== null && remote?.checkedOutMachine === state.machine;
  const behind = remote ? remote.headCommitId !== state.headCommitId : undefined;

  const lines = [`On ${state.owner}/${state.slug} branch ${state.branchName} at ${shortId(state.headCommitId)}`];
  if (!remote) lines.push(`Couldn't check the branch on the server: ${remoteError}`);
  else {
    if (remote.status !== 'open') lines.push(`The branch is ${remote.status}; it can't be changed.`);
    else if (lockedHere) lines.push('Checked out on this computer.');
    else if (remote.checkedOutBy) lines.push(`Checked out by @${remote.checkedOutByHandle} on ${remote.checkedOutMachine}.`);
    else lines.push('Not checked out. Run `giga checkout` before committing.');
    if (behind) lines.push('The branch has newer commits. Run `giga pull`.');
  }
  lines.push(...(changes.length === 0 ? ['No local changes.'] : ['Changes:', ...changes.map(describeChange)]));

  rt.out.result(
    {
      project: `${state.owner}/${state.slug}`,
      branch: state.branchName,
      branchId: state.branchId,
      headCommitId: state.headCommitId,
      remote: remote
        ? {
            status: remote.status,
            headCommitId: remote.headCommitId,
            behind,
            checkedOut: remote.checkedOutBy ? { handle: remote.checkedOutByHandle, machine: remote.checkedOutMachine, here: lockedHere } : null,
          }
        : null,
      changes,
    },
    lines,
  );
}

async function move(rt: Runtime, source: string, destination: string): Promise<void> {
  const workspace = await requireWorkspace(rt.ctx.cwd);
  const { root, state } = workspace;
  const from = workspacePath(root, rt.ctx.cwd, source);
  let to = workspacePath(root, rt.ctx.cwd, destination);
  const fromAbs = absolutePath(root, from);
  const info = await lstat(fromAbs).catch(() => undefined);
  if (!info) throw new CliError('not_found', `${source} does not exist`);
  if (info.isSymbolicLink()) throw new CliError('symlinks_not_supported', `${source} is a symbolic link`);

  const toInfo = await stat(absolutePath(root, to)).catch(() => undefined);
  if (toInfo?.isDirectory() && pathKey(to) !== pathKey(from)) to = `${to}/${basename(from)}`;
  const toAbs = absolutePath(root, to);
  const caseOnly = pathKey(from) === pathKey(to);
  if (from === to) throw new CliError('same_path', 'Source and destination are the same');
  if (!caseOnly && (await exists(toAbs))) throw new CliError('destination_exists', `${to} already exists`);
  if (info.isDirectory() && (pathKey(to).startsWith(`${pathKey(from)}/`))) {
    throw new CliError('invalid_move', 'Can’t move a folder into itself');
  }
  // Validates the new names the same way a scan would.
  if (/[<>:"|?*\\]/.test(to) || to.split('/').some((segment) => /[. ]$/.test(segment))) {
    throw new CliError('invalid_file_names', `${to} can’t be stored on Windows`);
  }

  const fromKey = pathKey(from);
  const remap = (path: string): string | undefined => {
    const key = pathKey(path);
    if (key === fromKey) return to;
    if (info.isDirectory() && key.startsWith(`${fromKey}/`)) return `${to}${path.slice(from.length)}`;
    return undefined;
  };
  const moved = Object.entries(state.tracked).flatMap(([path, itemId]) => {
    const next = remap(path);
    return next ? [{ from: path, to: next, itemId }] : [];
  });
  const remapKeys = <T>(record: Readonly<Record<string, T>>) =>
    Object.fromEntries(Object.entries(record).map(([path, value]) => [remap(path) ?? path, value]));
  const tracked = remapKeys(state.tracked);
  // A tracked file that is deleted locally still owns its path until the next commit.
  if (Object.keys(tracked).length !== Object.keys(state.tracked).length || new Set(Object.keys(tracked).map(pathKey)).size !== Object.keys(tracked).length) {
    throw new CliError('destination_exists', `${to} is already a tracked file`, { hint: 'Commit the deletion first, or pick another name.' });
  }

  await mkdir(dirname(toAbs), { recursive: true });
  await rename(fromAbs, toAbs);
  await removeEmptyParents(root, from);

  await saveWorkspace(root, { ...state, tracked, cache: remapKeys(state.cache) });

  rt.out.result(
    { from, to, moved },
    moved.length === 0
      ? `Moved ${from} -> ${to} (not tracked yet; it will be added on the next commit)`
      : [`Moved ${from} -> ${to}`, ...(moved.length > 1 ? [`${plural(moved.length, 'file')} keep their identity.`] : [])],
  );
}

async function checkin(rt: Runtime, options: { force?: boolean }): Promise<void> {
  const { workspace, session } = await workspaceSession(rt);
  requireSignedIn(session);
  if (!options.force) {
    const changes = localChanges(workspace.state, await scan(workspace));
    if (changes.length > 0) {
      throw new CliError('uncommitted_changes', `You have ${plural(changes.length, 'uncommitted change')}; checking in would let others commit over them`, {
        details: { paths: changes.map((change) => change.path) },
        hint: 'Commit them with `giga commit -m "..."`, or pass --force to check in anyway (your local files are kept).',
      });
    }
  }
  const branch = await session.api.post<BranchView>(`/v1/branches/${workspace.state.branchId}/checkin`);
  rt.out.result(branch, `Checked in ${workspace.state.branchName}. Others can check it out now.`);
}

async function commit(rt: Runtime, options: { message: string; label?: string }): Promise<void> {
  const { workspace, session } = await workspaceSession(rt);
  requireSignedIn(session);
  const { root, state } = workspace;
  const hashed = await scan(workspace);
  const changes = localChanges(state, hashed);
  if (changes.length === 0) throw new CliError('nothing_to_commit', 'No changes to commit');

  // Check before uploading anything, so a stale workspace doesn't send gigabytes first.
  const { branch } = await session.api.get<BranchDetail>(`/v1/branches/${state.branchId}`);
  if (branch.headCommitId !== state.headCommitId) {
    throw new CliError('stale_head', 'The branch has commits you don’t have yet; nothing was committed', {
      hint: 'Run `giga pull`, then commit again. Your local files are unchanged.',
    });
  }
  if (branch.checkedOutMachine !== state.machine) {
    throw new CliError(
      'not_checked_out',
      branch.checkedOutBy ? `The branch is checked out by @${branch.checkedOutByHandle} on ${branch.checkedOutMachine}` : 'The branch is not checked out',
      { hint: branch.checkedOutBy ? 'Ask them to check it in.' : 'Run `giga checkout` first. Your local files are unchanged.' },
    );
  }

  // Blobs in the synced snapshot are already in the project; only offer the rest.
  const synced = new Set(state.base.map((file) => file.blob));
  const uploads = await uploadBlobs(
    session.api,
    state.projectId,
    hashed
      .filter((file) => !synced.has(file.blob))
      .map((file) => ({ blob: file.blob, size: file.size, path: file.path, absolutePath: absolutePath(root, file.path) })),
    rt.out.progress.bind(rt.out),
  );
  const result = await session.api.post<CommitResult>(`/v1/branches/${state.branchId}/commits`, {
    parentId: state.headCommitId,
    machine: state.machine,
    kind: 'version',
    message: options.message,
    ...(options.label ? { versionLabel: options.label } : {}),
    files: commitFiles(state, hashed),
  });

  await saveWorkspace(root, {
    ...state,
    headCommitId: result.commit.id,
    base: result.files,
    tracked: trackedFrom(result.files),
    cache: cacheFrom(hashed),
  });

  const counts = ['added', 'modified', 'moved', 'deleted']
    .map((kind) => [kind, changes.filter((change) => change.kind === kind).length] as const)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind}`);
  rt.out.result(
    { commit: result.commit, changes, uploaded: uploads.uploaded, alreadyPresent: uploads.alreadyPresent },
    `Committed ${result.commit.versionLabel ? `${result.commit.versionLabel} ` : ''}${shortId(result.commit.id)} on ${state.branchName}: ${counts.join(', ')}`,
  );
}
