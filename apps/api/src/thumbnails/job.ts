import type { Sql } from '../db.js';
import { blobKey, thumbnailKey, type BlobStorage } from '../storage.js';
import { UnreadableFile, type ThumbnailFormat, type ThumbnailRenderer } from './index.js';

/** Larger files are skipped. STEP and IGES cost far more to tessellate than meshes cost to draw. */
export const MAX_THUMBNAIL_BYTES: Record<ThumbnailFormat, number> = {
  stl: 100 * 1024 ** 2,
  obj: 100 * 1024 ** 2,
  '3mf': 100 * 1024 ** 2,
  step: 25 * 1024 ** 2,
  iges: 25 * 1024 ** 2,
  // Only the preview is unpacked, so size matters little; the whole file is still read into memory.
  solidworks: 500 * 1024 ** 2,
};
/** A thumbnail whose attempts keep ending without a result (storage errors, restarts) gives up after this many. */
const MAX_ATTEMPTS = 3;

export interface ThumbnailDeps {
  readonly sql: Sql;
  readonly storage: BlobStorage;
  readonly renderer: ThumbnailRenderer;
  /** Told about errors that leave a thumbnail to be tried again, like storage being unreachable. */
  readonly onError?: (error: unknown, sha256: string) => void;
}

/**
 * Renders queued thumbnails, oldest first, until the queue is empty or the time is up.
 * Returns how many it finished (ready, failed, or skipped), or null if another instance
 * holds the lock.
 */
export async function generateThumbnails(deps: ThumbnailDeps, options: { budgetMs?: number } = {}): Promise<number | null> {
  const { sql, storage, renderer } = deps;
  const deadline = Date.now() + (options.budgetMs ?? 60_000);
  const reserved = await sql.reserve();
  try {
    const [lock] = await reserved<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtext('gigacad.thumbnails')) as locked`;
    if (!lock?.locked) return null;
    let finished = 0;
    const tried = new Set<string>();
    try {
      while (Date.now() < deadline) {
        // A file with an export (a SolidWorks part's STL, say) is drawn from the export.
        const [job] = await sql<{ sha256: string; source: string; format: ThumbnailFormat; size: number; attempts: number }[]>`
          update thumbnails t set attempts = t.attempts + 1, updated_at = now()
          from blobs b
          where b.sha256 = coalesce(t.model_sha256, t.blob_sha256)
            and t.blob_sha256 = (
              select blob_sha256 from thumbnails
              where status = 'pending' and not (blob_sha256 = any(${[...tried]}::text[]))
              order by created_at limit 1
            )
          returning t.blob_sha256 as sha256, b.sha256 as source, coalesce(t.model_format, t.format) as format, b.size::float8 as size, t.attempts
        `;
        if (!job) break;
        tried.add(job.sha256);
        const settle = (status: 'ready' | 'failed' | 'skipped', error: string | null = null) =>
          sql`update thumbnails set status = ${status}, error = ${error}, updated_at = now() where blob_sha256 = ${job.sha256}`;

        if (job.attempts > MAX_ATTEMPTS) {
          await settle('failed', 'This file couldn’t be previewed.');
        } else if (job.size > MAX_THUMBNAIL_BYTES[job.format]) {
          await settle('skipped', 'This file is too large to preview.');
        } else {
          try {
            const png = await renderer.render(await storage.read(blobKey(job.source)), job.format);
            await storage.write(thumbnailKey(job.sha256), png, 'image/png');
            await settle('ready');
          } catch (error) {
            // Unreadable files fail for good. Anything else (like storage) leaves the thumbnail
            // pending for the next run, up to MAX_ATTEMPTS, without holding up the rest of the queue.
            if (error instanceof UnreadableFile) await settle('failed', error.message);
            else deps.onError?.(error, job.sha256);
          }
        }
        finished++;
      }
    } finally {
      await reserved`select pg_advisory_unlock(hashtext('gigacad.thumbnails'))`;
    }
    return finished;
  } finally {
    reserved.release();
  }
}
