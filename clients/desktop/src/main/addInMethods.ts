import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { extname, relative, sep } from 'node:path';
import type { ProjectState } from '../shared/types.js';
import { locate } from './layout.js';
import type { PluginPipeServer } from './plugins/pipeServer.js';
import {
  METHODS,
  RpcError,
  type AttachExportParams,
  type BranchPathParams,
  type CommitVersionParams,
  type CommitVersionResult,
  type FileState,
  type GetFileStateParams,
  type ReportReferencesParams,
} from './plugins/protocol.js';

/** What the add-in methods need from the app: its folder, who's signed in, the projects, and the sync engine. */
export interface AddInHost {
  folder(): string;
  user(): { readonly handle: string } | null;
  projects(): readonly ProjectState[];
  checkout(projectId: string, branch: string): Promise<void>;
  checkin(projectId: string, branch: string): Promise<void>;
  commitVersion(projectId: string, branch: string, message: string, label: string): Promise<void>;
  /** Runs a giga command in `cwd` (a branch workspace). */
  giga(args: readonly string[], cwd: string): Promise<unknown>;
  /** PUT to the API. */
  put(path: string, body: unknown): Promise<unknown>;
}

/**
 * Where a path sits in the GigaCAD folder, as an add-in sees it: which project and branch, whether
 * it can be written, and who has the branch checked out. Drives SolidWorks' read-only banner.
 */
export function fileState(host: AddInHost, path: string): FileState {
  const location = locate(host.folder(), path);
  const project = location?.owner ? host.projects().find((candidate) => candidate.owner === location.owner && candidate.slug === location.project) : undefined;
  if (!location || !project) return { path, isGigaPath: false, writable: false };
  const base = { path, isGigaPath: true, project: `${project.owner}/${project.slug}` };

  if (location.area === 'branch' && location.name) {
    const branch = project.branches.find((candidate) => candidate.name === location.name);
    if (!branch) return { ...base, branch: location.name, writable: false };
    const checkedOutBy = branch.holder === 'me' ? host.user()?.handle : (branch.holderHandle ?? undefined);
    return {
      ...base,
      branch: branch.name,
      writable: branch.holder === 'me' && branch.status === 'open' && branch.downloaded,
      ...(checkedOutBy ? { checkedOutBy } : {}),
    };
  }
  // Root files sync on their own; anyone who can edit the project can change them.
  if (location.area === 'project-root' && location.inner) return { ...base, writable: project.role !== null && project.role !== 'viewer' };
  // Releases are permanent; the folders above projects and branches aren't files to edit.
  return { ...base, writable: false };
}

/** The project and branch for a path inside a branch folder, or an RpcError saying why not. */
function branchAt(host: AddInHost, path: string): { project: ProjectState; branch: string; dir: string } {
  const location = locate(host.folder(), path);
  const project = location?.owner ? host.projects().find((candidate) => candidate.owner === location.owner && candidate.slug === location.project) : undefined;
  if (!location || !project) throw new RpcError('not_in_gigacad', `${path} isn’t in the GigaCAD folder (${host.folder()})`);
  if (location.area !== 'branch' || !location.name || !location.areaDir) throw new RpcError('not_a_branch', `${path} isn’t in a branch folder. Check out, check in, and commit work inside Branches.`);
  return { project, branch: location.name, dir: location.areaDir };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new RpcError('bad_request', `${name} is required`);
  return value;
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** A path inside `dir`, with forward slashes as giga stores it, or undefined when it's outside. */
function insideBranch(dir: string, path: string): string | undefined {
  const rel = relative(dir, path);
  if (!rel || rel.startsWith('..') || /^[a-zA-Z]:|^[\\/]/.test(rel)) return undefined;
  return rel.split(sep).join('/');
}

/**
 * Registers the add-in methods on the pipe server (docs/clients/windows-app-plan.md, milestone W4).
 * Errors from giga and the API keep their codes (`checked_out`, `stale_head`, …).
 */
export function registerAddInMethods(server: PluginPipeServer, host: AddInHost): void {
  server.handle(METHODS.getFileState, (params) => {
    const { paths } = (params ?? {}) as Partial<GetFileStateParams>;
    if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) throw new RpcError('bad_request', 'paths must be a list of paths');
    return paths.map((path) => fileState(host, path));
  });

  server.handle(METHODS.checkout, async (params) => {
    const path = requireString((params as Partial<BranchPathParams> | undefined)?.path, 'path');
    const { project, branch } = branchAt(host, path);
    await host.checkout(project.id, branch);
    return fileState(host, path);
  });

  server.handle(METHODS.checkin, async (params) => {
    const path = requireString((params as Partial<BranchPathParams> | undefined)?.path, 'path');
    const { project, branch } = branchAt(host, path);
    await host.checkin(project.id, branch);
    return fileState(host, path);
  });

  server.handle(METHODS.commitVersion, async (params): Promise<CommitVersionResult> => {
    const input = (params ?? {}) as Partial<CommitVersionParams>;
    const path = requireString(input.path, 'path');
    const message = requireString(input.message, 'message');
    const { project, branch } = branchAt(host, path);
    await host.commitVersion(project.id, branch, message, typeof input.label === 'string' ? input.label : '');
    const head = host.projects().find((candidate) => candidate.id === project.id)?.branches.find((candidate) => candidate.name === branch)?.headCommitId;
    if (!head) throw new RpcError('internal', 'The version was committed, but GigaCAD couldn’t read its id');
    return { commitId: head };
  });

  server.handle(METHODS.reportReferences, async (params) => {
    const input = (params ?? {}) as Partial<ReportReferencesParams>;
    const path = requireString(input.path, 'path');
    if (!Array.isArray(input.references)) throw new RpcError('bad_request', 'references must be a list');
    const { project, dir } = branchAt(host, path);
    // References outside the branch (SolidWorks Toolbox parts, say) aren't project files.
    const paths = input.references
      .map((reference) => (typeof reference?.path === 'string' ? insideBranch(dir, reference.path) : undefined))
      .filter((reference): reference is string => reference !== undefined);
    await host.put(`/v1/projects/${project.id}/blobs/${await sha256Of(path)}/references`, { paths });
    return {};
  });

  server.handle(METHODS.attachExport, async (params) => {
    const input = (params ?? {}) as Partial<AttachExportParams>;
    const source = requireString(input.sourcePath, 'sourcePath');
    const exported = requireString(input.exportPath, 'exportPath');
    const format = extname(exported).toLowerCase() === '.stl' ? 'stl' : ['.step', '.stp'].includes(extname(exported).toLowerCase()) ? 'step' : undefined;
    if (!format) throw new RpcError('unsupported_export', `${exported} isn’t a STEP or STL file`);
    if (input.format !== undefined && input.format !== format) throw new RpcError('bad_request', `${exported} is ${format.toUpperCase()}, but format says ${String(input.format)}`);
    const { dir } = branchAt(host, source);
    const file = insideBranch(dir, source);
    if (!file) throw new RpcError('not_a_branch', `${source} isn’t a file in a branch`);
    await host.giga(['export', file, exported], dir);
    return {};
  });

  server.handle(METHODS.submitRebuildReport, () => {
    throw new RpcError(
      'not_implemented',
      'Release candidates aren’t in the GigaCAD folder yet, so rebuild reports can’t be sent from SolidWorks. Attach one with giga rr rebuild-report.',
    );
  });
}

/**
 * The branch folders whose state an add-in cares about (holder, status, head, downloaded), keyed by
 * folder. Comparing two of these says which folders to announce in files.stateChanged.
 */
export function branchSignatures(projects: readonly ProjectState[]): Map<string, string> {
  const signatures = new Map<string, string>();
  for (const project of projects) {
    for (const branch of project.branches) {
      signatures.set(branch.dir, [branch.holder ?? '', branch.holderHandle ?? '', branch.status, branch.headCommitId, branch.downloaded].join('|'));
    }
  }
  return signatures;
}

export function changedFolders(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const changed = new Set<string>();
  for (const [dir, signature] of after) if (before.get(dir) !== signature) changed.add(dir);
  for (const dir of before.keys()) if (!after.has(dir)) changed.add(dir);
  return [...changed];
}
