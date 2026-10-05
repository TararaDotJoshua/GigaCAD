import { execFile } from 'node:child_process';
import { chmod, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Custom-icon files stay writable so icons can change: Finder's "Icon" + carriage return, and
 * Windows' desktop.ini.
 */
const ICON_FILES = new Set(['Icon\r', 'desktop.ini']);
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
      if (entry.name === STATE_DIR || ICON_FILES.has(entry.name)) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
    dirs.push(current);
  }
  await visit(dir);
  return { files, dirs };
}

/**
 * Makes a release, or a branch this computer doesn't hold, read-only, so nothing in it can be
 * changed, added, renamed, or deleted by accident. It's a guard, not security: the owner can undo
 * it. `.giga/` and icon files stay writable.
 *
 * - macOS: files get mode 444 and Finder's Locked flag, then folders get mode 555.
 * - Windows: files get the read-only attribute (SolidWorks then opens them read-only), and each
 *   folder gets deny entries for this user: add file, add folder, and delete child on the folder,
 *   plus delete on everything directly inside it (inherited, so files a pull adds get it too).
 */
export async function lock(dir: string): Promise<void> {
  if (process.platform === 'win32') return windows.lock(dir);
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

/** Undoes `lock`. On macOS: folders first (so their contents can change), then the Locked flag, then write bits. */
export async function unlock(dir: string): Promise<void> {
  if (process.platform === 'win32') return windows.unlock(dir);
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

/** Whether `dir` is currently locked (its own folder can't be written). */
export async function isLocked(dir: string): Promise<boolean> {
  if (process.platform === 'win32') return windows.isLocked(dir);
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

async function chflags(flag: 'uchg' | 'nouchg', paths: readonly string[]): Promise<void> {
  // Batches keep each command line well under the system's argument limit.
  for (let start = 0; start < paths.length; start += 500) {
    await run('/usr/bin/chflags', [flag, ...paths.slice(start, start + 500)]);
  }
}

// --- Windows --------------------------------------------------------------------------------

/**
 * The folder rights a lock denies: WD (add file), AD (add subfolder), DC (delete child).
 * File contents are protected by the read-only attribute.
 */
export const DENIED_FOLDER_RIGHTS = '(WD,AD,DC)';
/**
 * Delete, denied on everything directly inside a locked folder: Windows lets a file be deleted
 * through delete permission on the file itself, whatever its folder says, and the owner has it.
 * Inherited to files and folders (OI, CI) one level down only (NP), not to the folder itself (IO),
 * so `.giga`'s contents stay free, and removing it from the folder removes every inherited copy.
 */
export const DENIED_CHILD_RIGHTS = '(OI)(CI)(NP)(IO)(D)';

/** This user's SID from `whoami /user /fo csv /nh`: `"pc\alex","S-1-5-21-…"`. */
export function parseUserSid(output: string): string {
  const sid = /"?(S-1-[0-9-]+)"?\s*$/m.exec(output.trim())?.[1];
  if (!sid) throw new Error(`Couldn't read this user's SID from whoami: ${output.trim()}`);
  return sid;
}

/**
 * Whether icacls lists a deny entry of the folder's own, like `DOMAIN\user:(DENY)(WD,AD,DC)`. A locked
 * folder is the only place GigaCAD adds one. Inherited entries (marked `(I)`) come from a locked parent
 * and don't make the folder itself locked.
 */
export function hasDenyEntry(icaclsOutput: string): boolean {
  return icaclsOutput.split(/\r?\n/).some((line) => /\(DENY\)/i.test(line) && !/\(I\)/.test(line));
}

const system32 = (tool: string) => `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\${tool}`;
let userSid: Promise<string> | undefined;
const sid = () => (userSid ??= run(system32('whoami.exe'), ['/user', '/fo', 'csv', '/nh']).then(({ stdout }) => parseUserSid(stdout)));
const icacls = (args: string[]) => run(system32('icacls.exe'), args, { windowsHide: true });

const windows = {
  async lock(dir: string): Promise<void> {
    const { files, dirs } = await walk(dir);
    // chmod on Windows sets or clears the read-only attribute.
    for (const file of files) {
      const { mode } = await lstat(file);
      if ((mode & 0o222) !== 0) await chmod(file, 0o444);
    }
    const account = `*${await sid()}`;
    for (const folder of dirs) {
      const { stdout } = await icacls([folder]);
      if (hasDenyEntry(stdout)) continue;
      await icacls([folder, '/deny', `${account}:${DENIED_FOLDER_RIGHTS}`, `${account}:${DENIED_CHILD_RIGHTS}`]);
    }
  },

  async unlock(dir: string): Promise<void> {
    const { files, dirs } = await walk(dir);
    const account = `*${await sid()}`;
    // Folders first, so the files inside can change. Removing a folder's entries removes the
    // copies its children inherited.
    for (const folder of dirs.reverse()) await icacls([folder, '/remove:d', account]);
    for (const file of files) {
      const { mode } = await lstat(file);
      if ((mode & 0o200) === 0) await chmod(file, 0o666);
    }
  },

  async isLocked(dir: string): Promise<boolean> {
    return hasDenyEntry((await icacls([dir])).stdout);
  },
};
