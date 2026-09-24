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
