import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CliError } from './errors.js';
import type { RootFile, RootFolder } from './rootSync.js';
import { stateDir, WORKSPACE_DIR, type CachedStat } from './workspace.js';

const ROOT_STATE_FILE = 'root.json';

/**
 * `.giga/root.json`: a folder that mirrors a project's root files and folders (not its
 * branches or releases). `files` and `folders` are what was last synced in both directions.
 */
export interface RootState {
  readonly version: 1;
  readonly apiUrl: string;
  readonly projectId: string;
  readonly owner: string;
  readonly slug: string;
  readonly files: readonly RootFile[];
  readonly folders: readonly RootFolder[];
  readonly cache: Readonly<Record<string, CachedStat>>;
}

export interface RootWorkspace {
  readonly root: string;
  readonly state: RootState;
}

/** Finds the project-root folder containing `cwd` by walking up to a `.giga/root.json`. */
export async function findRootWorkspace(cwd: string): Promise<RootWorkspace | undefined> {
  let dir = resolve(cwd);
  for (;;) {
    const file = join(dir, WORKSPACE_DIR, ROOT_STATE_FILE);
    const found = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
      throw error;
    });
    if (found !== undefined) {
      let state: RootState;
      try {
        state = JSON.parse(found) as RootState;
      } catch {
        throw new CliError('workspace_invalid', `Can't read ${file}`, { hint: 'Clone the project root again into a new folder.' });
      }
      if (state.version !== 1) throw new CliError('workspace_invalid', `${file} was written by a newer giga; upgrade @gigacad/cli`);
      return { root: dir, state };
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function requireRootWorkspace(cwd: string): Promise<RootWorkspace> {
  const found = await findRootWorkspace(cwd);
  if (!found) {
    throw new CliError('not_a_root_folder', 'Not inside a project root folder', {
      hint: 'Run `giga root clone <owner>/<project>` first, or cd into one.',
    });
  }
  return found;
}

/** Written atomically, like the branch workspace state. */
export async function saveRootWorkspace(root: string, state: RootState): Promise<void> {
  await mkdir(stateDir(root), { recursive: true });
  const target = join(stateDir(root), ROOT_STATE_FILE);
  const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temp, target);
}
