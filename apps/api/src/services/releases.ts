import type { Readable } from 'node:stream';
import type { ManifestEntry } from '@gigacad/core';
import type { Sql } from '../db.js';
import { notFound } from '../errors.js';
import { blobKey, type BlobStorage } from '../storage.js';
import { zipSize, zipStream } from '../zip.js';
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

/** SolidWorks parts and assemblies, the files that can have STEP and STL exports. */
const EXPORTABLE = /\.(sldprt|sldasm)$/i;

/**
 * The STEP and STL exports of a release's SolidWorks files, as `exports/<path>.step` and
 * `.stl`. A part and an assembly with the same name keep their extensions, so their exports
 * don't collide.
 */
async function exportFiles(sql: Sql, projectId: string, files: readonly ManifestEntry[]): Promise<{ path: string; blob: string }[]> {
  const sources = files.filter((file) => EXPORTABLE.test(file.path));
  if (sources.length === 0) return [];
  const rows = await sql<{ source: string; format: string; blob: string }[]>`
    select source_sha256 as source, format, blob_sha256 as blob from file_exports
    where project_id = ${projectId} and source_sha256 = any(${[...new Set(sources.map((file) => file.blob))]}::text[])
    order by format
  `;
  const bySource = new Map<string, { format: string; blob: string }[]>();
  for (const { source, ...row } of rows) bySource.set(source, [...(bySource.get(source) ?? []), row]);
  const exported = sources.filter((file) => bySource.has(file.blob));
  const stem = (path: string) => path.replace(EXPORTABLE, '');
  const stems = new Map<string, number>();
  for (const file of exported) stems.set(stem(file.path).toLowerCase(), (stems.get(stem(file.path).toLowerCase()) ?? 0) + 1);
  return exported.flatMap((file) => {
    const name = stems.get(stem(file.path).toLowerCase())! > 1 ? file.path : stem(file.path);
    return bySource.get(file.blob)!.map((row) => ({ path: `exports/${name}.${row.format}`, blob: row.blob }));
  });
}

/**
 * A release as one ZIP, every file under a `<project>-v<n>/` folder, optionally with its
 * SolidWorks files' exports in an `exports/` folder there. Streamed: nothing is held in
 * memory, so it works for assemblies of any size. `length` is the ZIP's exact size.
 */
export async function releaseArchive(
  sql: Sql,
  storage: BlobStorage,
  projectId: string,
  number: number,
  userId: string | null,
  options: { exports?: boolean | undefined } = {},
): Promise<{ filename: string; size: number; length: number; stream: Readable }> {
  const { release, files } = await getRelease(sql, projectId, number, userId);
  const [project] = await sql<{ slug: string }[]>`select slug from projects where id = ${projectId}`;
  const listed: { path: string; blob: string }[] = [...files, ...(options.exports ? await exportFiles(sql, projectId, files) : [])];
  const sizes = new Map(
    (await sql<{ sha256: string; size: number }[]>`select sha256, size::float8 as size from blobs where sha256 = any(${listed.map((file) => file.blob)}::text[])`).map((row) => [row.sha256, row.size]),
  );
  const folder = `${project?.slug ?? 'project'}-v${release.number}`;
  const entries = listed.map((file) => ({ path: `${folder}/${file.path}`, size: sizes.get(file.blob) ?? 0, open: () => storage.readStream(blobKey(file.blob)) }));
  const stream = zipStream(entries, { modified: release.createdAt });
  return {
    filename: options.exports ? `${folder}-with-exports.zip` : `${folder}.zip`,
    size: entries.reduce((total, entry) => total + entry.size, 0),
    length: zipSize(entries),
    stream,
  };
}
