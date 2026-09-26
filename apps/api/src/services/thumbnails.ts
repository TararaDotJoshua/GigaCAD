import type { Sql } from '../db.js';
import { thumbnailKey, type BlobStorage } from '../storage.js';
import { projectAccess } from './access.js';

export interface ThumbnailLinks {
  /** Short-lived image links, by file content hash, for thumbnails that are ready. */
  readonly thumbnails: Readonly<Record<string, string>>;
  /** Hashes whose thumbnails are still being made. */
  readonly pending: readonly string[];
}

/** Thumbnails for files in a project, for anyone who can see the project. */
export async function projectThumbnails(
  sql: Sql,
  storage: BlobStorage,
  projectId: string,
  viewerId: string | null,
  sha256s: readonly string[],
): Promise<ThumbnailLinks> {
  await projectAccess(sql, projectId, viewerId);
  const rows = await sql<{ sha256: string; status: 'pending' | 'ready' }[]>`
    select t.blob_sha256 as sha256, t.status from thumbnails t
    join project_blobs pb on pb.sha256 = t.blob_sha256 and pb.project_id = ${projectId}
    where t.blob_sha256 = any(${[...new Set(sha256s)]}::text[]) and t.status in ('pending', 'ready')
  `;
  const ready = await Promise.all(
    rows.filter((row) => row.status === 'ready').map(async (row) => [row.sha256, await storage.presignDownload(thumbnailKey(row.sha256))] as const),
  );
  return { thumbnails: Object.fromEntries(ready), pending: rows.filter((row) => row.status === 'pending').map((row) => row.sha256) };
}

/** Swaps each row's `thumbnailSha` (from `project_thumbnail()`) for a short-lived image link. */
export async function withCovers<T extends { thumbnailSha: string | null }>(
  storage: BlobStorage,
  rows: readonly T[],
): Promise<(Omit<T, 'thumbnailSha'> & { thumbnailUrl: string | null })[]> {
  return Promise.all(
    rows.map(async ({ thumbnailSha, ...row }) => ({ ...row, thumbnailUrl: thumbnailSha ? await storage.presignDownload(thumbnailKey(thumbnailSha)) : null })),
  );
}
