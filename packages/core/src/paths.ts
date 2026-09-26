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
  if (WINDOWS_DEVICE_NAMES.test(name)) throw new InvalidPathError(name, 'name is reserved by Windows');
  if (options.atRoot && isReservedRootName(name)) throw new InvalidPathError(name, `"${name}" is reserved for the project's ${name.toLowerCase()} folder`);
  return name;
}

export function isReservedRootName(name: string): boolean {
  return RESERVED_ROOT_NAMES.some((reserved) => reserved.toLowerCase() === name.toLowerCase());
}
