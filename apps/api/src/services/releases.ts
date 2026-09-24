import type { ManifestEntry } from '@gigacad/core';
import type { Sql } from '../db.js';
import { notFound } from '../errors.js';
import { projectAccess } from './access.js';
import { loadManifest } from './manifests.js';

export interface ReleaseView {
  readonly id: string;
  readonly number: number;
  readonly manifestId: string;
  readonly notes: string;
  readonly releaseRequestId: string | null;
  readonly createdBy: string | null;
  readonly createdByHandle: string | null;
  readonly createdAt: Date;
}

export async function listReleases(sql: Sql, projectId: string, userId: string | null): Promise<ReleaseView[]> {
  await projectAccess(sql, projectId, userId);
  return sql<ReleaseView[]>`
    select r.id, r.number, r.manifest_id, r.notes, r.release_request_id, r.created_by, p.handle as created_by_handle, r.created_at
    from releases r left join profiles p on p.id = r.created_by
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
    select r.id, r.number, r.manifest_id, r.notes, r.release_request_id, r.created_by, p.handle as created_by_handle, r.created_at
    from releases r left join profiles p on p.id = r.created_by
    where r.project_id = ${projectId} and r.number = ${number}
  `;
  if (!release) throw notFound(`Release v${number}`);
  return { release, files: await loadManifest(sql, release.manifestId) };
}
