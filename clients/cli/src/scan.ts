import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createIgnoreMatcher, normalizePath, pathKey, type IgnoreMatcher } from '@gigacad/core';
import { CliError } from './errors.js';
import { absolutePath, WORKSPACE_DIR, type CachedStat } from './workspace.js';

export interface WorkingFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface HashedFile extends WorkingFile {
  readonly blob: string;
}

// Characters Windows (and so the GigaCAD drive and SolidWorks) can't store in a file name.
const WINDOWS_INVALID = /[<>:"|?*\\\u0000-\u001f]/;

export async function loadIgnoreMatcher(root: string): Promise<IgnoreMatcher> {
  const gigaignore = await readFile(join(root, '.gigaignore'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return createIgnoreMatcher(gigaignore);
}

/**
 * Lists the workspace files that would be committed: everything except `.giga/`,
 * ignored files (default rules plus `.gigaignore`), and nothing else. Tracked files
 * are never ignored. Symlinks, names Windows can't store, and paths that differ only
 * in case are errors, because they can't round-trip through GigaCAD.
 */
export async function listWorkingFiles(root: string, tracked: Iterable<string> = []): Promise<WorkingFile[]> {
  const isIgnored = await loadIgnoreMatcher(root);
  const trackedKeys = new Set([...tracked].map(pathKey));
  const keep = (path: string) => trackedKeys.has(pathKey(path)) || !isIgnored(path);

  const files: WorkingFile[] = [];
  const symlinks: string[] = [];
  const badNames: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (prefix === '' && entry.name.toLowerCase() === WORKSPACE_DIR) continue;
      const path = `${prefix}${entry.name}`;
      if (WINDOWS_INVALID.test(entry.name) || /[. ]$/.test(entry.name)) {
        if (keep(path.replace(/\\/g, '_'))) badNames.push(path);
        continue;
      }
      const normalized = normalizePath(path);
      if (entry.isSymbolicLink()) {
        if (keep(normalized)) symlinks.push(normalized);
      } else if (entry.isDirectory()) {
        await walk(join(dir, entry.name), `${normalized}/`);
      } else if (entry.isFile() && keep(normalized)) {
        const info = await lstat(join(dir, entry.name));
        files.push({ path: normalized, size: info.size, mtimeMs: info.mtimeMs });
      }
    }
  }
  await walk(root, '');

  if (symlinks.length > 0) {
    throw new CliError('symlinks_not_supported', 'Symbolic links can’t be versioned; replace them with real files or add them to .gigaignore', {
      details: { paths: symlinks },
    });
  }
  if (badNames.length > 0) {
    throw new CliError('invalid_file_names', 'Some names can’t be stored on Windows; rename them or add them to .gigaignore', {
      details: { paths: badNames },
    });
  }
  const collisions = caseCollisions(files.map((file) => file.path));
  if (collisions.length > 0) {
    throw new CliError('case_collision', 'Some paths differ only in letter case; Windows treats them as the same file', {
      details: { paths: collisions },
    });
  }
  return files;
}

export function caseCollisions(paths: readonly string[]): string[] {
  const byKey = new Map<string, string[]>();
  for (const path of paths) {
    const key = path.toLowerCase();
    byKey.set(key, [...(byKey.get(key) ?? []), path]);
  }
  return [...byKey.values()].filter((group) => group.length > 1).flat();
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** Hashes each file as a stream, skipping files whose size and modification time match the cache. */
export async function hashFiles(root: string, files: readonly WorkingFile[], cache: Readonly<Record<string, CachedStat>>): Promise<HashedFile[]> {
  return mapLimit(files, 8, async (file) => {
    const cached = cache[file.path];
    if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs) return { ...file, blob: cached.blob };
    return { ...file, blob: await hashFile(absolutePath(root, file.path)) };
  });
}

export function cacheFrom(files: readonly HashedFile[]): Record<string, CachedStat> {
  return Object.fromEntries(files.map((file) => [file.path, { size: file.size, mtimeMs: file.mtimeMs, blob: file.blob }]));
}

/** Runs `run` over `items` with at most `limit` in flight, keeping order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
