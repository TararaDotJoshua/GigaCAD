import { normalizePath } from '@gigacad/core';
import type { Sql } from '../db.js';
import { unprocessable } from '../errors.js';
import {
  blobKey,
  MAX_SINGLE_UPLOAD_BYTES,
  sha256Base64,
  stagingKey,
  type BlobStorage,
  type PresignedUpload,
} from '../storage.js';
import { projectAccess, requireProjectRole } from './access.js';

export interface BlobDescriptor {
  readonly sha256: string;
  readonly size: number;
}

export interface UploadPlan {
  /** Already in the project; nothing to upload. */
  readonly present: readonly string[];
  readonly uploads: readonly (PresignedUpload & { readonly uploadId: string; readonly sha256: string })[];
}

/** Hands out one upload per file the project doesn't have yet. */
export async function planUploads(
  sql: Sql,
  storage: BlobStorage,
  projectId: string,
  userId: string,
  blobs: readonly BlobDescriptor[],
): Promise<UploadPlan> {
  await requireProjectRole(sql, projectId, userId, 'contributor');
  const tooLarge = blobs.filter((blob) => blob.size > MAX_SINGLE_UPLOAD_BYTES);
  if (tooLarge.length > 0) {
    throw unprocessable('file_too_large', 'Files over 5 GB are not supported yet', { sha256s: tooLarge.map((b) => b.sha256) });
  }

  const unique = [...new Map(blobs.map((blob) => [blob.sha256, blob])).values()];
  const linked = await sql<{ sha256: string }[]>`
    select sha256 from project_blobs
    where project_id = ${projectId} and sha256 = any(${unique.map((b) => b.sha256)}::text[])
  `;
  const present = new Set(linked.map((row) => row.sha256));
  const needed = unique.filter((blob) => !present.has(blob.sha256));
  if (needed.length === 0) return { present: [...present], uploads: [] };

  const rows = await sql<{ id: string; sha256: string }[]>`
    insert into blob_uploads ${sql(needed.map((blob) => ({ projectId, sha256: blob.sha256, size: blob.size, createdBy: userId })))}
    returning id, sha256
  `;
  const uploads = await Promise.all(
    rows.map(async (row) => ({
      uploadId: row.id,
      sha256: row.sha256,
      ...(await storage.presignUpload(stagingKey(row.id), row.sha256)),
    })),
  );
  return { present: [...present], uploads };
}

export interface CompletionResult {
  readonly completed: readonly string[];
  readonly failed: readonly { readonly uploadId: string; readonly reason: string }[];
}

/**
 * Verifies each staged upload (size and storage-checked SHA-256), moves it to its
 * content-addressed key if it's new, and links it to the project.
 */
export async function completeUploads(
  sql: Sql,
  storage: BlobStorage,
  projectId: string,
  userId: string,
  uploadIds: readonly string[],
): Promise<CompletionResult> {
  await requireProjectRole(sql, projectId, userId, 'contributor');
  const pending = await sql<{ id: string; sha256: string; size: number }[]>`
    select id, sha256, size::float8 as size from blob_uploads
    where project_id = ${projectId} and id = any(${[...uploadIds]}::uuid[])
  `;
  const pendingById = new Map(pending.map((row) => [row.id, row]));
  const completed: string[] = [];
  const failed: { uploadId: string; reason: string }[] = [];

  for (const uploadId of uploadIds) {
    const upload = pendingById.get(uploadId);
    if (!upload) {
      failed.push({ uploadId, reason: 'unknown_upload' });
      continue;
    }
    const staged = await storage.stat(stagingKey(uploadId));
    const reason = !staged
      ? 'not_uploaded'
      : staged.size !== upload.size
        ? 'size_mismatch'
        : staged.checksumSha256 !== sha256Base64(upload.sha256)
          ? 'checksum_mismatch'
          : undefined;
    if (reason) {
      failed.push({ uploadId, reason });
      continue;
    }

    const [known] = await sql`select 1 from blobs where sha256 = ${upload.sha256}`;
    if (!known) await storage.copy(stagingKey(uploadId), blobKey(upload.sha256));
    await sql.begin(async (tx) => {
      await tx`insert into blobs (sha256, size) values (${upload.sha256}, ${upload.size}) on conflict do nothing`;
      await tx`
        insert into project_blobs (project_id, sha256, uploaded_by) values (${projectId}, ${upload.sha256}, ${userId})
        on conflict do nothing
      `;
      await tx`delete from blob_uploads where id = ${uploadId}`;
    });
    await storage.remove(stagingKey(uploadId));
    completed.push(upload.sha256);
  }
  return { completed, failed };
}

export async function planDownloads(
  sql: Sql,
  storage: BlobStorage,
  projectId: string,
  userId: string | null,
  sha256s: readonly string[],
): Promise<{ downloads: readonly { sha256: string; url: string }[]; missing: readonly string[] }> {
  await projectAccess(sql, projectId, userId);
  const unique = [...new Set(sha256s)];
  const linked = await sql<{ sha256: string }[]>`
    select sha256 from project_blobs where project_id = ${projectId} and sha256 = any(${unique}::text[])
  `;
  const available = new Set(linked.map((row) => row.sha256));
  const downloads = await Promise.all(
    unique.filter((sha) => available.has(sha)).map(async (sha256) => ({ sha256, url: await storage.presignDownload(blobKey(sha256)) })),
  );
  return { downloads, missing: unique.filter((sha) => !available.has(sha)) };
}

/** Records which files a blob references (from the SolidWorks add-in), replacing any earlier report. */
export async function setReferences(sql: Sql, projectId: string, userId: string, sha256: string, paths: readonly string[]): Promise<string[]> {
  await requireProjectRole(sql, projectId, userId, 'contributor');
  const normalized = [...new Set(paths.map((path) => normalizePath(path)))];
  return sql.begin(async (tx) => {
    const [linked] = await tx`select 1 from project_blobs where project_id = ${projectId} and sha256 = ${sha256}`;
    if (!linked) throw unprocessable('missing_blobs', 'Upload this file before reporting its references', { sha256s: [sha256] });
    await tx`delete from blob_references where project_id = ${projectId} and sha256 = ${sha256}`;
    if (normalized.length > 0) {
      await tx`insert into blob_references ${tx(normalized.map((referencedPath) => ({ projectId, sha256, referencedPath })))}`;
    }
    return normalized;
  });
}
