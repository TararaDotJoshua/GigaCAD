import { execFile } from 'node:child_process';
import { chmod, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Finder's custom-icon file ("Icon" + carriage return). It stays writable so icons can change. */
const ICON_FILE = 'Icon\r';
/** giga's own state folder must stay writable: pulls into a locked branch update it. */
const STATE_DIR = '.giga';

interface Tree {
  readonly files: string[];
  readonly dirs: string[];
}

/** Everything under `dir` except `.giga/` and icon files. `dirs` lists deepest first and includes `dir`. */
async function walk(dir: string): Promise<Tree> {
  const files: string[] = [];
  const dirs: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === STATE_DIR || entry.name === ICON_FILE) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
    dirs.push(current);
  }
  await visit(dir);
  return { files, dirs };
}

async function chflags(flag: 'uchg' | 'nouchg', paths: readonly string[]): Promise<void> {
  // Batches keep each command line well under the system's argument limit.
  for (let start = 0; start < paths.length; start += 500) {
    await run('/usr/bin/chflags', [flag, ...paths.slice(start, start + 500)]);
  }
}

/**
 * Makes a release, or a branch this Mac doesn't hold, read-only: files get mode 444 and
 * Finder's Locked flag, then folders get mode 555 so nothing can be added, renamed, or
 * deleted. The order matters: a file that is already Locked refuses mode changes.
 */
export async function lock(dir: string): Promise<void> {
  const { files, dirs } = await walk(dir);
  for (const file of files) {
    const { mode } = await lstat(file);
    // Already read-only (and maybe already Locked, which refuses chmod): nothing to change.
    if ((mode & 0o222) !== 0) await chmod(file, mode & ~0o222);
  }
  await chflags('uchg', files);
  for (const folder of dirs) {
    const { mode } = await lstat(folder);
    await chmod(folder, mode & ~0o222);
  }
}

/** Undoes `lock`: folders first (so their contents can change), then the Locked flag, then write bits. */
export async function unlock(dir: string): Promise<void> {
  const { files, dirs } = await walk(dir);
  for (const folder of dirs.reverse()) {
    const { mode } = await lstat(folder);
    await chmod(folder, mode | 0o200);
  }
  await chflags('nouchg', files);
  for (const file of files) {
    const { mode } = await lstat(file);
    await chmod(file, mode | 0o200);
  }
}

/** Whether `dir` is currently locked (its own folder isn't writable). */
export async function isLocked(dir: string): Promise<boolean> {
  const { mode } = await lstat(dir);
  return (mode & 0o200) === 0;
}

/** Runs `change` with `dir` unlocked, then locks it again, even if `change` fails. */
export async function whileUnlocked<T>(dir: string, change: () => Promise<T>): Promise<T> {
  await unlock(dir);
  try {
    return await change();
  } finally {
    await lock(dir);
  }
}
