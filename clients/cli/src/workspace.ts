import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { normalizePath, pathKey, type ManifestEntry } from '@gigacad/core';
import { CliError } from './errors.js';

export const WORKSPACE_DIR = '.giga';
const STATE_FILE = 'workspace.json';

/** What `giga` knows about a file it last hashed, so unchanged files aren't read again. */
export interface CachedStat {
  readonly size: number;
  readonly mtimeMs: number;
  readonly blob: string;
}

/** `.giga/workspace.json`: the branch this folder tracks and the snapshot it was last synced to. */
export interface WorkspaceState {
  readonly version: 1;
  readonly apiUrl: string;
  readonly projectId: string;
  readonly owner: string;
  readonly slug: string;
  readonly branchId: string;
  readonly branchName: string;
  /** The machine name used for this workspace's check-out lock. */
  readonly machine: string;
  /** The branch commit the local files were last synced to; commits are made on top of it. */
  readonly headCommitId: string;
  /** The files of `headCommitId`. */
  readonly base: readonly ManifestEntry[];
  /** Current path → item id. Starts equal to `base`; `giga mv` moves entries so renamed files keep their identity. */
  readonly tracked: Readonly<Record<string, string>>;
  readonly cache: Readonly<Record<string, CachedStat>>;
}

export interface Workspace {
  readonly root: string;
  readonly state: WorkspaceState;
}

export const stateDir = (root: string) => join(root, WORKSPACE_DIR);
export const tempDir = (root: string) => join(root, WORKSPACE_DIR, 'tmp');

export function trackedFrom(files: readonly ManifestEntry[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.path, file.itemId]));
}

/** Finds the workspace containing `cwd` by walking up to a folder with `.giga/workspace.json`. */
export async function findWorkspace(cwd: string): Promise<Workspace | undefined> {
  let dir = resolve(cwd);
  for (;;) {
    const file = join(dir, WORKSPACE_DIR, STATE_FILE);
    const found = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
      throw error;
    });
    if (found !== undefined) {
      let state: WorkspaceState;
      try {
        state = JSON.parse(found) as WorkspaceState;
      } catch {
        throw new CliError('workspace_invalid', `Can't read ${file}`, { hint: 'Clone the branch again into a new folder.' });
      }
      if (state.version !== 1) throw new CliError('workspace_invalid', `${file} was written by a newer giga; upgrade @gigacad/cli`);
      return { root: dir, state };
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function requireWorkspace(cwd: string): Promise<Workspace> {
  const workspace = await findWorkspace(cwd);
  if (!workspace) {
    throw new CliError('not_a_workspace', 'Not inside a giga workspace', {
      hint: 'Run `giga clone <owner>/<project> --branch <name>` first, or cd into a cloned folder.',
    });
  }
  return workspace;
}

/** Written atomically: a crash leaves either the old or the new state, never half of one. */
export async function saveWorkspace(root: string, state: WorkspaceState): Promise<void> {
  await mkdir(stateDir(root), { recursive: true });
  const target = join(stateDir(root), STATE_FILE);
  const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temp, target);
}

/** Converts a path the user typed (relative to where they are) into a workspace path like `parts/P1.SLDPRT`. */
export function workspacePath(root: string, cwd: string, input: string): string {
  const absolute = resolve(cwd, input);
  const rel = relative(root, absolute);
  if (rel === '' || rel.startsWith('..') || resolve(root, rel) !== absolute) {
    throw new CliError('outside_workspace', `${input} is not inside the workspace`);
  }
  const path = normalizePath(rel.split(sep).join('/'));
  if (pathKey(path) === WORKSPACE_DIR || pathKey(path).startsWith(`${WORKSPACE_DIR}/`)) {
    throw new CliError('outside_workspace', `${input} is inside giga's own ${WORKSPACE_DIR} folder`);
  }
  return path;
}

export function absolutePath(root: string, path: string): string {
  return join(root, ...path.split('/'));
}

export async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      throw error;
    },
  );
}
