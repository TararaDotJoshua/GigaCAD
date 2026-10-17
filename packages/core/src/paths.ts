export class InvalidPathError extends Error {
  constructor(
    readonly input: string,
    readonly reason: string,
  ) {
    super(`Invalid project path "${input}": ${reason}`);
    this.name = 'InvalidPathError';
  }
}

/**
 * Normalizes a project-relative file path: forward slashes, no leading "./",
 * no duplicate slashes. Rejects absolute paths, folders, and "." / ".." segments.
 */
export function normalizePath(input: string): string {
  let path = input.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (path.startsWith('./')) path = path.slice(2);

  if (path === '') throw new InvalidPathError(input, 'path is empty');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new InvalidPathError(input, 'path must be relative to the project root');
  }
  if (path.endsWith('/')) throw new InvalidPathError(input, 'path must name a file, not a folder');
  for (const segment of path.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new InvalidPathError(input, 'path must not contain "." or ".." segments');
    }
  }
  return path;
}

/**
 * Comparison key for a path. Windows (and therefore SolidWorks) treats paths
 * case-insensitively, so two files differing only in case are the same file.
 */
export function pathKey(input: string): string {
  return normalizePath(input).toLowerCase();
}

export function comparePaths(a: string, b: string): number {
  const keyA = a.toLowerCase();
  const keyB = b.toLowerCase();
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Longest project path, matching the database's limit on manifest paths. */
export const MAX_PATH_LENGTH = 1024;
export const MAX_ENTRY_NAME_LENGTH = 255;

/** Folders every project root shows for its branches and releases; nobody can create an entry with these names there. */
export const RESERVED_ROOT_NAMES = ['Branches', 'Releases'] as const;

const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
/** Text direction marks, overrides, and isolates, which make a name read as something else ("exe.TXT"). */
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/**
 * Checks one file or folder name in the project directory. Names must also work on
 * Windows, where SolidWorks opens them, so its reserved characters and device names are refused.
 */
export function validateEntryName(name: string, options: { atRoot?: boolean } = {}): string {
  if (name.length === 0) throw new InvalidPathError(name, 'name is empty');
  if (name.length > MAX_ENTRY_NAME_LENGTH) throw new InvalidPathError(name, `name is longer than ${MAX_ENTRY_NAME_LENGTH} characters`);
  if (name === '.' || name === '..') throw new InvalidPathError(name, 'name must not be "." or ".."');
  if (/[\x00-\x1f<>:"/\\|?*]/.test(name)) throw new InvalidPathError(name, 'name must not contain < > : " / \\ | ? * or control characters');
  if (/[. ]$/.test(name) || /^ /.test(name)) throw new InvalidPathError(name, 'name must not start with a space or end with a space or dot');
  if (BIDI_CONTROLS.test(name)) throw new InvalidPathError(name, 'name must not contain text direction controls');
  if (WINDOWS_DEVICE_NAMES.test(name)) throw new InvalidPathError(name, 'name is reserved by Windows');
  if (options.atRoot && isReservedRootName(name)) throw new InvalidPathError(name, `"${name}" is reserved for the project's ${name.toLowerCase()} folder`);
  return name;
}

/**
 * Normalizes a project path and checks only what Windows can't store at all: reserved and
 * control characters, names ending in a dot or space, and device names. Clients on Windows use
 * it for paths already on the server, which may hold names (a leading space, text direction
 * controls) that new commits refuse but Windows stores fine.
 */
export function validateWindowsPath(input: string): string {
  const path = normalizePath(input);
  for (const name of path.split('/')) {
    if (/[\x00-\x1f<>:"\\|?*]/.test(name)) throw new InvalidPathError(input, 'name must not contain < > : " \\ | ? * or control characters');
    if (/[. ]$/.test(name)) throw new InvalidPathError(input, 'name must not end with a space or dot');
    if (WINDOWS_DEVICE_NAMES.test(name)) throw new InvalidPathError(input, 'name is reserved by Windows');
  }
  return path;
}

export function isReservedRootName(name: string): boolean {
  return RESERVED_ROOT_NAMES.some((reserved) => reserved.toLowerCase() === name.toLowerCase());
}

/**
 * Normalizes a project path and checks every folder and file name in it like
 * `validateEntryName`, so a branch commit can't hold a path a Windows teammate can't sync
 * (stream colons, device names, reserved characters, trailing dots) or one that displays
 * as something else.
 */
export function validateProjectPath(input: string): string {
  const path = normalizePath(input);
  if (path.length > MAX_PATH_LENGTH) throw new InvalidPathError(input, `path is longer than ${MAX_PATH_LENGTH} characters`);
  for (const segment of path.split('/')) {
    try {
      validateEntryName(segment);
    } catch (error) {
      if (error instanceof InvalidPathError) throw new InvalidPathError(input, error.reason);
      throw error;
    }
  }
  return path;
}

/** Branch names: letters, digits, dots, dashes and underscores, starting and ending with a letter or digit. */
export const BRANCH_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;

/** What's wrong with a branch name, in a sentence for the person typing it; null when it's fine. */
export function branchNameProblem(name: string): string | null {
  if (name.length === 0) return 'Give the branch a name.';
  if (name.length > 100) return 'Use 100 characters or fewer.';
  if (/[^A-Za-z0-9._-]/.test(name)) return 'Use letters, digits, dots, dashes, or underscores.';
  if (!BRANCH_NAME.test(name)) return 'Start and end with a letter or digit.';
  return null;
}
