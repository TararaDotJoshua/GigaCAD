import type { Sql } from '../db.js';
import { unprocessable } from '../errors.js';
import { blobKey, type BlobStorage } from '../storage.js';
import { projectAccess, requireProjectRole } from './access.js';
import { recordEvent } from './events.js';

/**
 * STEP and STL exports of SolidWorks files. SolidWorks' format is closed, so the server
 * can't convert it; exports come from SolidWorks itself (the add-in exports on commit and
 * when a release is rebuilt) or are uploaded by hand. Each is a normal uploaded file,
 * linked to the SolidWorks file it was made from.
 */

export type ExportFormat = 'stl' | 'step';

export interface FileExport {
  readonly format: ExportFormat;
  readonly sha256: string;
  readonly size: number;
}

/** SolidWorks parts and assemblies; drawings have no geometry to export. */
const EXPORTABLE = /\.(sldprt|sldasm)$/i;

/** How much of an export is read to tell its format: room for a byte order mark and blank lines before a STEP header. */
const HEAD_BYTES = 512;

/**
 * Whether a file's first bytes and size fit the format it's claimed to be. A binary STL is
 * an 80-byte header, a triangle count, and 50 bytes per triangle; a text STL starts with
 * `solid`; a STEP file starts with `ISO-10303-21`.
 */
export function looksLike(format: ExportFormat, head: Uint8Array, size: number): boolean {
  // Decoding drops a UTF-8 byte order mark.
  const text = new TextDecoder().decode(head).trimStart();
  if (format === 'step') return text.startsWith('ISO-10303-21');
  if (text.startsWith('solid')) return true;
  return head.byteLength >= 84 && size === 84 + 50 * new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(80, true);
}

async function readHead(storage: BlobStorage, sha256: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let read = 0;
  for await (const chunk of await storage.readStream(blobKey(sha256))) {
    chunks.push(chunk);
    read += chunk.byteLength;
    // Leaving the loop closes the stream, so the rest of a large file is never fetched.
    if (read >= HEAD_BYTES) break;
  }
  return Buffer.concat(chunks).subarray(0, HEAD_BYTES);
}

/**
 * Links an uploaded export to the SolidWorks file it was made from, replacing any earlier
 * one. The export must look like the format it's added as: a STEP file added as an STL would
 * otherwise break the file's thumbnail and preview.
 */
export async function setFileExport(
  sql: Sql,
  storage: BlobStorage,
  projectId: string,
  userId: string,
  input: { source: string; format: ExportFormat; blob: string },
): Promise<FileExport> {
  return sql.begin(async (tx) => {
    await requireProjectRole(tx, projectId, userId, 'contributor');
    const [source] = await tx`
      select 1 from manifest_entries me join manifests m on m.id = me.manifest_id
      where m.project_id = ${projectId} and me.blob_sha256 = ${input.source} and me.path ~* ${EXPORTABLE.source}
      union all
      select 1 from root_file_revisions r join directory_entries e on e.id = r.entry_id
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
    if (!looksLike(input.format, await readHead(storage, input.blob), blob.size)) {
      throw unprocessable('export_wrong_format', `This file isn’t ${input.format === 'stl' ? 'an STL' : 'a STEP'} file`, { format: input.format });
    }
    // Open pages refresh on project events, so they pick up the new export.
    await recordEvent(tx, { projectId, actorId: userId, kind: 'file_export_attached', payload: { source: input.source, format: input.format, blob: input.blob } });

    await tx`
      insert into file_exports (project_id, source_sha256, format, blob_sha256, created_by)
      values (${projectId}, ${input.source}, ${input.format}, ${input.blob}, ${userId})
      on conflict (project_id, source_sha256, format)
      do update set blob_sha256 = excluded.blob_sha256, created_by = excluded.created_by, created_at = now()
    `;
    // Draw the file's thumbnail from its geometry: an STL always, a STEP unless there's an STL.
    await tx`
      insert into thumbnails (blob_sha256, format, model_sha256, model_format)
      values (${input.source}, 'solidworks', ${input.blob}, ${input.format})
      on conflict (blob_sha256) do update
      set model_sha256 = excluded.model_sha256, model_format = excluded.model_format,
          status = 'pending', attempts = 0, error = null, updated_at = now()
      where ${input.format} = 'stl' or thumbnails.model_format is distinct from 'stl'
    `;
    return { format: input.format, sha256: input.blob, size: blob.size };
  });
}

/** Exports for files in a project, by source file hash, for anyone who can see the project. */
export async function listFileExports(
  sql: Sql,
  projectId: string,
  viewerId: string | null,
  sources: readonly string[],
): Promise<Record<string, FileExport[]>> {
  await projectAccess(sql, projectId, viewerId);
  const rows = await sql<(FileExport & { source: string })[]>`
    select x.source_sha256 as source, x.format, x.blob_sha256 as sha256, b.size::float8 as size
    from file_exports x join blobs b on b.sha256 = x.blob_sha256
    where x.project_id = ${projectId} and x.source_sha256 = any(${[...new Set(sources)]}::text[])
    order by x.format
  `;
  const exports: Record<string, FileExport[]> = {};
  for (const { source, ...entry } of rows) (exports[source] ??= []).push(entry);
  return exports;
}
