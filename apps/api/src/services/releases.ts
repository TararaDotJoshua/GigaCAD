import type { Readable } from 'node:stream';
import type { ManifestEntry } from '@gigacad/core';
import type { Sql } from '../db.js';
import { notFound } from '../errors.js';
import { blobKey, type BlobStorage } from '../storage.js';
import { zipStream } from '../zip.js';
import { projectAccess } from './access.js';
import { loadManifest } from './manifests.js';

export interface ReleaseView {
  readonly id: string;
  readonly number: number;
  readonly manifestId: string;
  readonly notes: string;
  readonly releaseRequestId: string | null;
  /** The release request's title, which names the release. Null for releases made without one. */
  readonly title: string | null;
  readonly releaseRequestNumber: number | null;
  readonly createdBy: string | null;
  readonly createdByHandle: string | null;
  readonly createdAt: Date;
}

export async function listReleases(sql: Sql, projectId: string, userId: string | null): Promise<ReleaseView[]> {
  await projectAccess(sql, projectId, userId);
  return sql<ReleaseView[]>`
    select r.id, r.number, r.manifest_id, r.notes, r.release_request_id, rr.title, rr.number as release_request_number,
           r.created_by, p.handle as created_by_handle, r.created_at
    from releases r
    left join profiles p on p.id = r.created_by
    left join release_requests rr on rr.id = r.release_request_id
    where r.project_id = ${projectId}
    order by r.number desc
  `;
}

export async function getRelease(
  sql: Sql,
  projectId: string,
  number: number,
  userId: string | null,
): Promise<{ release: ReleaseView; files: ManifestEntry[] }> {
  await projectAccess(sql, projectId, userId);
  const [release] = await sql<ReleaseView[]>`
    select r.id, r.number, r.manifest_id, r.notes, r.release_request_id, rr.title, rr.number as release_request_number,
           r.created_by, p.handle as created_by_handle, r.created_at
    from releases r
    left join profiles p on p.id = r.created_by
    left join release_requests rr on rr.id = r.release_request_id
    where r.project_id = ${projectId} and r.number = ${number}
  `;
  if (!release) throw notFound(`Release v${number}`);
  return { release, files: await loadManifest(sql, release.manifestId) };
}

/**
 * A release as one ZIP, every file under a `<project>-v<n>/` folder. Streamed: nothing is
 * held in memory, so it works for assemblies of any size.
 */
export async function releaseArchive(
  sql: Sql,
  storage: BlobStorage,
  projectId: string,
  number: number,
  userId: string | null,
): Promise<{ filename: string; size: number; stream: Readable }> {
  const { release, files } = await getRelease(sql, projectId, number, userId);
  const [project] = await sql<{ slug: string }[]>`select slug from projects where id = ${projectId}`;
  const sizes = new Map(
    (await sql<{ sha256: string; size: number }[]>`select sha256, size::float8 as size from blobs where sha256 = any(${files.map((file) => file.blob)}::text[])`).map((row) => [row.sha256, row.size]),
  );
  const folder = `${project?.slug ?? 'project'}-v${release.number}`;
  const entries = files.map((file) => ({ path: `${folder}/${file.path}`, size: sizes.get(file.blob) ?? 0, open: () => storage.readStream(blobKey(file.blob)) }));
  const stream = zipStream(entries, { modified: release.createdAt });
  return { filename: `${folder}.zip`, size: entries.reduce((total, entry) => total + entry.size, 0), stream };
}
