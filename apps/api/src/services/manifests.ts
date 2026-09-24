import {
  InvalidPathError,
  normalizePath,
  pathKey,
  validateManifest,
  type Manifest,
  type ManifestEntry,
} from '@gigacad/core';
import type { Db } from '../db.js';
import { unprocessable } from '../errors.js';

const INSERT_BATCH = 2000;

export async function loadManifest(db: Db, manifestId: string): Promise<ManifestEntry[]> {
  return db<ManifestEntry[]>`
    select item_id, path, blob_sha256 as blob
    from manifest_entries where manifest_id = ${manifestId}
    order by path_key, path
  `;
}

export async function insertManifest(db: Db, projectId: string, entries: Manifest): Promise<string> {
  const [manifest] = await db<{ id: string }[]>`insert into manifests (project_id) values (${projectId}) returning id`;
  const id = manifest!.id;
  for (let start = 0; start < entries.length; start += INSERT_BATCH) {
    const rows = entries
      .slice(start, start + INSERT_BATCH)
      .map((entry) => ({ manifestId: id, itemId: entry.itemId, path: entry.path, blobSha256: entry.blob }));
    await db`insert into manifest_entries ${db(rows)}`;
  }
  return id;
}

export async function releaseManifestId(db: Db, releaseId: string | null): Promise<string | null> {
  if (!releaseId) return null;
  const [release] = await db<{ manifestId: string }[]>`select manifest_id from releases where id = ${releaseId}`;
  return release?.manifestId ?? null;
}

export async function loadReleaseManifest(db: Db, releaseId: string | null): Promise<ManifestEntry[]> {
  const manifestId = await releaseManifestId(db, releaseId);
  return manifestId ? loadManifest(db, manifestId) : [];
}

/** Deletes manifests nothing points at anymore (e.g. pruned autosaves). */
export async function deleteUnreferencedManifests(db: Db, manifestIds: readonly string[]): Promise<void> {
  if (manifestIds.length === 0) return;
  await db`
    delete from manifests m
    where m.id = any(${[...manifestIds]}::uuid[])
      and not exists (select 1 from commits c where c.manifest_id = m.id)
      and not exists (select 1 from releases r where r.manifest_id = m.id)
      and not exists (
        select 1 from release_requests rr
        where rr.candidate_manifest_id = m.id or rr.rebuild_manifest_id = m.id
      )
      and not exists (select 1 from approvals a where a.candidate_manifest_id = m.id)
  `;
}

export interface FileInput {
  readonly path: string;
  readonly blob: string;
  /** Omit for files without a known identity; the server reuses the previous item at the same path or creates one. */
  readonly itemId?: string | undefined;
}

/**
 * Turns uploaded file listings into manifest entries: normalizes paths, keeps
 * item identity across saves, and checks every blob was uploaded to this project.
 */
export async function resolveFiles(
  db: Db,
  projectId: string,
  files: readonly FileInput[],
  previous: Manifest,
): Promise<ManifestEntry[]> {
  const normalized = files.map((file) => {
    try {
      return { ...file, path: normalizePath(file.path) };
    } catch (error) {
      if (error instanceof InvalidPathError) throw unprocessable('invalid_path', error.message, { path: file.path });
      throw error;
    }
  });

  const explicitIds = [...new Set(normalized.flatMap((file) => (file.itemId ? [file.itemId] : [])))];
  if (explicitIds.length > 0) {
    const known = await db<{ id: string }[]>`
      select id from items where project_id = ${projectId} and id = any(${explicitIds}::uuid[])
    `;
    const knownIds = new Set(known.map((row) => row.id));
    const unknown = explicitIds.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) throw unprocessable('unknown_items', 'Some item ids do not belong to this project', { itemIds: unknown });
  }

  const previousByPath = new Map(previous.map((entry) => [pathKey(entry.path), entry.itemId]));
  const claimed = new Set(explicitIds);
  const itemIds = normalized.map((file) => {
    if (file.itemId) return file.itemId;
    const reused = previousByPath.get(pathKey(file.path));
    if (reused && !claimed.has(reused)) {
      claimed.add(reused);
      return reused;
    }
    return undefined;
  });

  const needed = itemIds.filter((id) => id === undefined).length;
  const created =
    needed === 0
      ? []
      : await db<{ id: string }[]>`
          insert into items (project_id) select ${projectId}::uuid from generate_series(1, ${needed}) returning id
        `;
  let next = 0;
  const entries = normalized.map((file, index) => ({
    itemId: itemIds[index] ?? created[next++]!.id,
    path: file.path,
    blob: file.blob,
  }));

  const issues = validateManifest(entries);
  if (issues.length > 0) throw unprocessable('invalid_manifest', 'The file list is invalid', { issues });

  const blobs = [...new Set(entries.map((entry) => entry.blob))];
  if (blobs.length > 0) {
    const present = await db<{ sha256: string }[]>`
      select sha256 from project_blobs where project_id = ${projectId} and sha256 = any(${blobs}::text[])
    `;
    const presentSet = new Set(present.map((row) => row.sha256));
    const missing = blobs.filter((sha) => !presentSet.has(sha));
    if (missing.length > 0) throw unprocessable('missing_blobs', 'Upload these files before committing', { sha256s: missing });
  }
  return entries;
}
