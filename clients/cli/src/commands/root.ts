import { mkdir, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathKey, type IgnoreMatcher } from '@gigacad/core';
import type { Command } from 'commander';
import type { Api } from '../api.js';
import type { Bind, Runtime } from '../cli.js';
import { CliError } from '../errors.js';
import { plural } from '../output.js';
import { findProject, parseProjectRef } from '../resolve.js';
import { findRootWorkspace, requireRootWorkspace, saveRootWorkspace, type RootState, type RootWorkspace } from '../rootWorkspace.js';
import { isEmptyPlan, pendingRootChanges, planRootSync, type LocalTree, type RootFile, type RootPlan, type RootSnapshot } from '../rootSync.js';
import { cacheFrom, hashFiles, listWorkingFiles, loadIgnoreMatcher, type HashedFile } from '../scan.js';
import { requireSignedIn, type Session } from '../session.js';
import { downloadBlobs, placeDownloads, uploadBlobs, type DownloadTarget } from '../transfer.js';
import { absolutePath, tempDir } from '../workspace.js';

/** Top-level folders of a project root that belong to GigaCAD, not to the root's own files. */
const RESERVED = new Set(['branches', 'releases']);

/** Branch workspaces and exported releases live under Branches/ and Releases/; nested state folders are theirs. */
const skipFolder = (path: string) => {
  const k = path.toLowerCase();
  return (!k.includes('/') && RESERVED.has(k)) || k.endsWith('/.giga');
};

export function registerRootCommands(program: Command, bind: Bind): void {
  const root = program
    .command('root')
    .description('Sync a project’s root files and folders (not its branches or releases) with a local folder');
  root
    .command('clone <project> [directory]')
    .description('Download a project’s root files and folders into a new or empty folder')
    .action(bind(cloneRoot));
  root.command('status').description('List root changes waiting to be pushed').action(bind(rootStatus));
  root.command('pull').description('Download root changes, keeping local edits (both-sided edits keep a "(conflict)" copy)').action(bind(pullRoot));
  root
    .command('push')
    .description('Pull, then upload local changes: new files and folders, new revisions, renames, and deletions')
    .action(bind(pushRoot));
}

interface EntryView {
  readonly id: string;
  readonly path: string;
}

interface FilesPage {
  readonly entries: readonly { readonly path: string; readonly entryId: string | null; readonly blob: string }[];
  readonly nextOffset: number | null;
}

/** The project's root files and folders as the server has them now. */
async function remoteSnapshot(api: Api, projectId: string): Promise<RootSnapshot> {
  const folders = await api.get<{ id: string; path: string }[]>(`/v1/projects/${projectId}/directory/folders`);
  const files: RootFile[] = [];
  for (let offset: number | null = 0; offset !== null; ) {
    const page: FilesPage = await api.get<FilesPage>(`/v1/projects/${projectId}/files?area=root&limit=500&offset=${offset}`);
    for (const file of page.entries) if (file.entryId) files.push({ entryId: file.entryId, path: file.path, blob: file.blob });
    offset = page.nextOffset;
  }
  return { files, folders: folders.map((folder) => ({ entryId: folder.id, path: folder.path })) };
}

interface LocalScan {
  readonly hashed: readonly HashedFile[];
  readonly folders: readonly string[];
}

async function scanRoot(root: string, state: RootState): Promise<LocalScan> {
  const folders: string[] = [];
  const files = await listWorkingFiles(
    root,
    state.files.map((file) => file.path),
    { skipFolder, folders },
  );
  return { hashed: await hashFiles(root, files, state.cache), folders };
}

const tree = (scan: LocalScan): LocalTree => ({ files: scan.hashed, folders: scan.folders });

/**
 * The state after a sync: a server file counts as synced when the same bytes sit at its path here.
 * Anything else keeps its previous synced state, so a pending local edit or delete stays pending,
 * and a file that changed on both sides meanwhile shows up as a conflict next time instead of being lost.
 */
function nextState(state: RootState, local: LocalScan, remote: RootSnapshot): RootState {
  const localByKey = new Map(local.hashed.map((file) => [pathKey(file.path), file]));
  const previous = new Map(state.files.map((file) => [file.entryId, file]));
  const files: RootFile[] = [];
  for (const theirs of remote.files) {
    const mine = localByKey.get(pathKey(theirs.path));
    if (mine && mine.blob === theirs.blob) files.push(theirs);
    else {
      const old = previous.get(theirs.entryId);
      if (old) files.push(old);
    }
  }
  const localFolders = new Set(local.folders.map(pathKey));
  const previousFolders = new Set(state.folders.map((folder) => pathKey(folder.path)));
  const folders = remote.folders.filter((folder) => localFolders.has(pathKey(folder.path)) || previousFolders.has(pathKey(folder.path)));
  return { ...state, files, folders, cache: cacheFrom(local.hashed) };
}

/** Removes a folder the server deleted, if all that's left in it is clutter like Finder's icon file. */
async function removeFolderIfUnused(root: string, path: string, isIgnored: IgnoreMatcher): Promise<void> {
  const dir = absolutePath(root, path);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
  if (!entries || entries.some((entry) => !entry.isFile() || !isIgnored(`${path}/${entry.name}`))) return;
  for (const entry of entries) await rm(join(dir, entry.name), { force: true });
  await rmdir(dir);
}

async function applyLocal(rt: Runtime, api: Api, root: string, state: RootState, plan: RootPlan): Promise<void> {
  const at = (path: string) => absolutePath(root, path);
  for (const folder of plan.localFolders) await mkdir(at(folder), { recursive: true });
  for (const move of [...plan.localMoves, ...plan.conflictCopies]) {
    await mkdir(dirname(at(move.to)), { recursive: true });
    await rename(at(move.from), at(move.to));
  }
  for (const path of plan.localDeletes) await rm(at(path), { force: true });
  if (plan.downloads.length > 0) {
    const targets: DownloadTarget[] = plan.downloads.map((file) => ({ blob: file.blob, path: file.path, absolutePath: at(file.path) }));
    const downloaded = await downloadBlobs(api, state.projectId, targets, tempDir(root), rt.out.progress.bind(rt.out));
    await placeDownloads(targets, downloaded);
    await rm(tempDir(root), { recursive: true, force: true });
  }
  if (plan.removeLocalFolders.length > 0) {
    const isIgnored = await loadIgnoreMatcher(root);
    for (const folder of plan.removeLocalFolders) await removeFolderIfUnused(root, folder, isIgnored);
  }
}

async function applyRemote(rt: Runtime, api: Api, root: string, state: RootState, plan: RootPlan, remote: RootSnapshot, local: LocalScan): Promise<void> {
  const base = `/v1/projects/${state.projectId}/directory`;
  const folderIds = new Map(remote.folders.map((folder) => [pathKey(folder.path), folder.entryId]));
  const parentId = (path: string): string | null => {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (parent === '') return null;
    const id = folderIds.get(pathKey(parent));
    if (!id) throw new CliError('root_sync_failed', `The folder for ${path} doesn't exist on the server yet`, { hint: 'Run `giga root push` again.' });
    return id;
  };

  for (const path of plan.createFolders) {
    rt.out.progress(`Creating folder ${path}`);
    const folder = await api.post<EntryView>(`${base}/folders`, { parentId: parentId(path), name: basename(path) });
    folderIds.set(pathKey(path), folder.id);
  }

  const sizes = new Map(local.hashed.map((file) => [file.blob, file.size]));
  const outgoing = [...plan.creates, ...plan.replaces];
  await uploadBlobs(
    api,
    state.projectId,
    outgoing.map((file) => ({ blob: file.blob, size: sizes.get(file.blob) ?? 0, path: file.path, absolutePath: absolutePath(root, file.path) })),
    rt.out.progress.bind(rt.out),
  );

  for (const move of plan.moves) {
    await api.request('PATCH', `${base}/entries/${move.entryId}`, { name: basename(move.to), parentId: parentId(move.to) });
  }
  for (const file of plan.replaces) await api.post(`${base}/entries/${file.entryId}/revisions`, { blob: file.blob });
  for (const file of plan.creates) await api.post(`${base}/files`, { parentId: parentId(file.path), name: basename(file.path), blob: file.blob });

  const gone = (error: unknown) => {
    if ((error as { status?: number }).status !== 404) throw error;
  };
  for (const file of plan.deleteFiles) await api.delete(`${base}/entries/${file.entryId}`).catch(gone);
  for (const folder of plan.deleteFolders) await api.delete(`${base}/entries/${folder.entryId}`).catch(gone);
}

async function rootSession(rt: Runtime, workspace: RootWorkspace): Promise<Session> {
  return rt.session({ ignoreWorkspace: true, workspaceApiUrl: workspace.state.apiUrl });
}

function describe(plan: RootPlan, pushed: boolean) {
  const data = {
    downloaded: plan.downloads.map((file) => file.path),
    deletedHere: plan.localDeletes,
    movedHere: plan.localMoves,
    conflicts: plan.conflictCopies.map((copy) => ({ path: copy.from, copy: copy.to })),
    ...(pushed
      ? {
          created: plan.creates.map((file) => file.path),
          updated: plan.replaces.map((file) => file.path),
          moved: plan.moves.map(({ from, to }) => ({ from, to })),
          deleted: [...plan.deleteFiles, ...plan.deleteFolders].map((entry) => entry.path),
          foldersCreated: plan.createFolders,
        }
      : {}),
  };
  const parts = [
    data.downloaded.length > 0 && `${plural(data.downloaded.length, 'file')} downloaded`,
    data.deletedHere.length > 0 && `${data.deletedHere.length} deleted here`,
    data.movedHere.length > 0 && `${data.movedHere.length} moved here`,
    pushed && plan.createFolders.length > 0 && `${plural(plan.createFolders.length, 'folder')} created`,
    pushed && plan.creates.length > 0 && `${plural(plan.creates.length, 'file')} added`,
    pushed && plan.replaces.length > 0 && `${plural(plan.replaces.length, 'new revision')}`,
    pushed && plan.moves.length > 0 && `${plan.moves.length} renamed or moved`,
    pushed && plan.deleteFiles.length + plan.deleteFolders.length > 0 && `${plan.deleteFiles.length + plan.deleteFolders.length} deleted`,
  ].filter(Boolean);
  const lines = [parts.length > 0 ? `${pushed ? 'Synced' : 'Pulled'}: ${parts.join(', ')}.` : 'Already up to date.'];
  for (const copy of data.conflicts) lines.push(`Conflict: ${copy.path} changed here and on the server. Your version is now ${copy.copy}.`);
  return { data, lines };
}

async function cloneRoot(rt: Runtime, projectInput: string, directory: string | undefined): Promise<void> {
  const { ctx, out } = rt;
  const ref = parseProjectRef(projectInput);
  /** A new folder, an empty one, or one that only holds GigaCAD's Branches and Releases folders and Finder clutter. */
  const checkTarget = async (root: string) => {
    const entries = await readdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    const allowed = (name: string) => RESERVED.has(name.toLowerCase()) || name === '.DS_Store' || name === 'Icon\r';
    if (entries?.some((name) => !allowed(name))) {
      throw new CliError('directory_not_empty', `${root} already exists and is not empty`, { hint: 'Clone into a new or empty folder.' });
    }
    const outer = await findRootWorkspace(dirname(root));
    if (outer) throw new CliError('nested_workspace', `${root} is inside another project root folder (${outer.root})`, { hint: 'Clone somewhere else.' });
    return entries === undefined;
  };
  if (directory) await checkTarget(resolve(ctx.cwd, directory));

  const session = await rt.session({ ignoreWorkspace: true });
  const project = await findProject(session.api, ref);
  const root = resolve(ctx.cwd, directory ?? project.slug);
  const created = await checkTarget(root);
  const remote = await remoteSnapshot(session.api, project.id);

  const empty: RootState = {
    version: 1,
    apiUrl: session.apiUrl,
    projectId: project.id,
    owner: project.ownerHandle,
    slug: project.slug,
    files: [],
    folders: [],
    cache: {},
  };
  await mkdir(root, { recursive: true });
  let state: RootState;
  try {
    out.progress(`Cloning the root of ${project.ownerHandle}/${project.slug} (${plural(remote.files.length, 'file')})`);
    await applyLocal(rt, session.api, root, empty, planRootSync(empty, { files: [], folders: [] }, remote));
    state = nextState(empty, await scanRoot(root, empty), remote);
    await saveRootWorkspace(root, state);
  } catch (error) {
    if (created) await rm(root, { recursive: true, force: true });
    throw error;
  }
  out.result(
    { directory: root, projectId: project.id, files: state.files.length, folders: state.folders.length },
    `Cloned the root of ${project.ownerHandle}/${project.slug} into ${root} (${plural(state.files.length, 'file')}, ${plural(state.folders.length, 'folder')})`,
  );
}

async function rootStatus(rt: Runtime): Promise<void> {
  const { root, state } = await requireRootWorkspace(rt.ctx.cwd);
  const local = await scanRoot(root, state);
  const changes = pendingRootChanges(state, tree(local));
  const lines = [
    ...changes.addedFolders.map((path) => `  new folder ${path}/`),
    ...changes.added.map((path) => `  added     ${path}`),
    ...changes.modified.map((path) => `  modified  ${path}`),
    ...changes.moved.map(({ from, to }) => `  moved     ${from} -> ${to}`),
    ...changes.deleted.map((path) => `  deleted   ${path}`),
    ...changes.deletedFolders.map((path) => `  deleted   ${path}/`),
  ];
  rt.out.result(
    { directory: root, projectId: state.projectId, changes },
    [`Root of ${state.owner}/${state.slug}`, lines.length > 0 ? 'Changes to push:' : 'No local changes.', ...lines],
  );
}

async function pullRoot(rt: Runtime): Promise<void> {
  const workspace = await requireRootWorkspace(rt.ctx.cwd);
  const { root, state } = workspace;
  const session = await rootSession(rt, workspace);
  const remote = await remoteSnapshot(session.api, state.projectId);
  const plan = planRootSync(state, tree(await scanRoot(root, state)), remote);
  await applyLocal(rt, session.api, root, state, plan);
  await saveRootWorkspace(root, nextState(state, await scanRoot(root, state), remote));
  const { data, lines } = describe(plan, false);
  rt.out.result(data, lines);
}

async function pushRoot(rt: Runtime): Promise<void> {
  const workspace = await requireRootWorkspace(rt.ctx.cwd);
  const { root } = workspace;
  let { state } = workspace;
  const session = await rootSession(rt, workspace);
  requireSignedIn(session);

  const remote = await remoteSnapshot(session.api, state.projectId);
  const plan = planRootSync(state, tree(await scanRoot(root, state)), remote);
  if (!isEmptyPlan(plan)) {
    await applyLocal(rt, session.api, root, state, plan);
    const afterPull = await scanRoot(root, state);
    // Save between the halves: a failed push then retries only what's left.
    state = nextState(state, afterPull, remote);
    await saveRootWorkspace(root, state);
    await applyRemote(rt, session.api, root, state, plan, remote, afterPull);
    const synced = await remoteSnapshot(session.api, state.projectId);
    await saveRootWorkspace(root, nextState(state, await scanRoot(root, state), synced));
  }
  const { data, lines } = describe(plan, true);
  rt.out.result(data, lines);
}
