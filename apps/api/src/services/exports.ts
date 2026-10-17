import type { Db, Sql } from '../db.js';
import { notFound, unprocessable } from '../errors.js';
import { projectAccess, requireProjectRole } from './access.js';
import { recordEvent } from './events.js';

/**
 * STEP and STL exports of SolidWorks files. SolidWorks' format is closed, so the server
 * can't convert it; exports come from SolidWorks itself (the add-in exports on commit and
 * when a release is rebuilt) or are uploaded by hand. Each is a normal uploaded file,
 * linked to the SolidWorks file it was made from. A release keeps a copy of the links its
 * files had when it was made, so replacing an export never changes a release.
 */

export type ExportFormat = 'stl' | 'step';

export interface FileExport {
  readonly format: ExportFormat;
  readonly sha256: string;
  readonly size: number;
}

/** SolidWorks parts and assemblies; drawings have no geometry to export. */
const EXPORTABLE = /\.(sldprt|sldasm)$/i;

/** Links an uploaded export to the SolidWorks file it was made from, replacing any earlier one. */
export async function setFileExport(
  sql: Sql,
  projectId: string,
  userId: string,
  input: { source: string; format: ExportFormat; blob: string },
): Promise<FileExport> {
  return sql.begin(async (tx) => {
    // The project lock queues this behind a release in progress, so an export can't change between
    // the release's approval check and the snapshot of the exports it keeps.
    await requireProjectRole(tx, projectId, userId, 'contributor', { lock: true });
    const [source] = await tx<{ path: string }[]>`
      select me.path from manifest_entries me join manifests m on m.id = me.manifest_id
      where m.project_id = ${projectId} and me.blob_sha256 = ${input.source} and me.path ~* ${EXPORTABLE.source}
      union all
      select e.name from root_file_revisions r join directory_entries e on e.id = r.entry_id
      where r.project_id = ${projectId} and r.blob_sha256 = ${input.source} and e.name ~* ${EXPORTABLE.source}
      limit 1
    `;
    if (!source) throw unprocessable('not_exportable', 'Exports can only be added to SolidWorks parts and assemblies in this project');
    const [blob] = await tx<{ size: number }[]>`
      select b.size::float8 as size from project_blobs pb join blobs b on b.sha256 = pb.sha256
      where pb.project_id = ${projectId} and pb.sha256 = ${input.blob}
    `;
    if (!blob) throw unprocessable('export_not_uploaded', 'Upload the export file to this project first');
    if (input.blob === input.source) throw unprocessable('export_is_source', 'An export must be a different file from its source');

    const [previous] = await tx<{ blobSha256: string }[]>`
      select blob_sha256 from file_exports
      where project_id = ${projectId} and source_sha256 = ${input.source} and format = ${input.format}
      for update
    `;
    await tx`
      insert into file_exports (project_id, source_sha256, format, blob_sha256, created_by)
      values (${projectId}, ${input.source}, ${input.format}, ${input.blob}, ${userId})
      on conflict (project_id, source_sha256, format)
      do update set blob_sha256 = excluded.blob_sha256, created_by = excluded.created_by, created_at = now()
      -- Attaching the same export again changes nothing, so it mustn't look newer than the approvals it would void.
      where file_exports.blob_sha256 is distinct from excluded.blob_sha256
    `;
    // The export is drawn as its own file, by its own content. The source file's thumbnail row is
    // shared by every project holding the same bytes, so it is never changed from here; this
    // project's thumbnail lookups pick the export's image instead (file_thumbnail()).
    await tx`insert into thumbnails (blob_sha256, format) values (${input.blob}, ${input.format}) on conflict (blob_sha256) do nothing`;
    // Releases keep the exports they were made with, so a replaced export shows only outside them.
    if (previous?.blobSha256 !== input.blob) {
      await recordEvent(tx, {
        projectId,
        actorId: userId,
        kind: previous ? 'export_replaced' : 'export_attached',
        payload: { path: source.path, source: input.source, format: input.format, blob: input.blob, ...(previous ? { previousBlob: previous.blobSha256 } : {}) },
      });
    }
    return { format: input.format, sha256: input.blob, size: blob.size };
  });
}

/** Copies the current exports of a manifest's files into a new release, which keeps them for good, and marks it copied. */
export async function snapshotReleaseExports(db: Db, projectId: string, releaseId: string, manifestId: string): Promise<void> {
  await db`
    insert into release_exports (release_id, project_id, source_sha256, format, blob_sha256)
    select distinct ${releaseId}::uuid, x.project_id, x.source_sha256, x.format, x.blob_sha256
    from manifest_entries me join file_exports x on x.project_id = ${projectId} and x.source_sha256 = me.blob_sha256
    where me.manifest_id = ${manifestId}
    on conflict do nothing
  `;
  await db`insert into release_export_snapshots (release_id) values (${releaseId}) on conflict do nothing`;
}

/**
 * Exports for files in a project, by source file hash, for anyone who can see the project.
 * With a release number, the exports that release was made with.
 */
export async function listFileExports(
  sql: Sql,
  projectId: string,
  viewerId: string | null,
  sources: readonly string[],
  releaseNumber?: number | undefined,
): Promise<Record<string, FileExport[]>> {
  await projectAccess(sql, projectId, viewerId);
  const unique = [...new Set(sources)];
  let rows: (FileExport & { source: string })[];
  if (releaseNumber === undefined) {
    rows = await sql<(FileExport & { source: string })[]>`
      select x.source_sha256 as source, x.format, x.blob_sha256 as sha256, b.size::float8 as size
      from file_exports x join blobs b on b.sha256 = x.blob_sha256
      where x.project_id = ${projectId} and x.source_sha256 = any(${unique}::text[])
      order by x.format
    `;
  } else {
    const [release] = await sql<{ id: string }[]>`select id from releases where project_id = ${projectId} and number = ${releaseNumber}`;
    if (!release) throw notFound('Release');
    rows = await sql<(FileExport & { source: string })[]>`
      select x.source_sha256 as source, x.format, x.blob_sha256 as sha256, b.size::float8 as size
      from release_exports x join blobs b on b.sha256 = x.blob_sha256
      where x.release_id = ${release.id} and x.source_sha256 = any(${unique}::text[])
      order by x.format
    `;
  }
  const exports: Record<string, FileExport[]> = {};
  for (const { source, ...entry } of rows) (exports[source] ??= []).push(entry);
  return exports;
}
