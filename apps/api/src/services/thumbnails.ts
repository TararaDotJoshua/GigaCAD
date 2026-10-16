import type { Sql } from '../db.js';
import { thumbnailKey, type BlobStorage } from '../storage.js';
import { projectAccess } from './access.js';

export interface ThumbnailLinks {
  /** Short-lived image links, by file content hash, for thumbnails that are ready. */
  readonly thumbnails: Readonly<Record<string, string>>;
  /** Hashes whose thumbnails are still being made. */
  readonly pending: readonly string[];
}

/**
 * Thumbnails for files in a project, for anyone who can see the project. A SolidWorks file
 * shows this project's own STL or STEP export when it has one, so another project holding the
 * same file can never change what this one shows.
 */
export async function projectThumbnails(
  sql: Sql,
  storage: BlobStorage,
  projectId: string,
  viewerId: string | null,
  sha256s: readonly string[],
): Promise<ThumbnailLinks> {
  await projectAccess(sql, projectId, viewerId);
  const rows = await sql<{ sha256: string; image: string | null; pending: boolean }[]>`
    select pb.sha256, file_thumbnail(${projectId}, pb.sha256) as image,
           exists (
             select 1 from thumbnails t
             where t.status = 'pending' and (t.blob_sha256 = pb.sha256 or t.blob_sha256 in (
               select x.blob_sha256 from file_exports x where x.project_id = ${projectId} and x.source_sha256 = pb.sha256
             ))
           ) as pending
    from project_blobs pb
    where pb.project_id = ${projectId} and pb.sha256 = any(${[...new Set(sha256s)]}::text[])
  `;
  const ready = await Promise.all(
    rows.filter((row) => row.image).map(async (row) => [row.sha256, await storage.presignDownload(thumbnailKey(row.image!))] as const),
  );
  return { thumbnails: Object.fromEntries(ready), pending: rows.filter((row) => !row.image && row.pending).map((row) => row.sha256) };
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
