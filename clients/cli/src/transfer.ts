import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Api, DownloadPlan, UploadCompletion, UploadPlan } from './api.js';
import { CliError } from './errors.js';
import { mapLimit } from './scan.js';

/** The API accepts up to 1000 blobs per request; smaller batches keep presigned URLs fresh on big commits. */
export const TRANSFER_BATCH = 200;
const CONCURRENCY = 4;

export interface UploadSource {
  readonly blob: string;
  readonly size: number;
  readonly absolutePath: string;
  /** For messages. */
  readonly path: string;
}

export interface UploadSummary {
  readonly uploaded: number;
  readonly alreadyPresent: number;
  readonly bytes: number;
}

/**
 * Uploads the files the project doesn't have yet: plans each batch with the API,
 * sends bytes straight to storage with the checksum headers the API requires,
 * then asks the API to verify and link them.
 */
export async function uploadBlobs(
  api: Api,
  projectId: string,
  sources: readonly UploadSource[],
  progress: (message: string) => void,
): Promise<UploadSummary> {
  const byBlob = new Map(sources.map((source) => [source.blob, source]));
  const unique = [...byBlob.values()];
  let uploaded = 0;
  let alreadyPresent = 0;
  let bytes = 0;

  for (let start = 0; start < unique.length; start += TRANSFER_BATCH) {
    const batch = unique.slice(start, start + TRANSFER_BATCH);
    const plan = await api.post<UploadPlan>(`/v1/projects/${projectId}/blobs/uploads`, {
      blobs: batch.map((source) => ({ sha256: source.blob, size: source.size })),
    });
    alreadyPresent += batch.length - plan.uploads.length;
    if (plan.uploads.length === 0) continue;

    await mapLimit(plan.uploads, CONCURRENCY, async (upload) => {
      const source = byBlob.get(upload.sha256);
      if (!source) throw new CliError('upload_failed', 'The API asked for a file giga did not offer');
      const current = await stat(source.absolutePath);
      if (current.size !== source.size) {
        throw new CliError('file_changed', `${source.path} changed while committing`, { hint: 'Save and close it, then commit again.' });
      }
      progress(`Uploading ${source.path}`);
      await putFile(upload.url, upload.headers, source);
      bytes += source.size;
    });

    const completion = await api.post<UploadCompletion>(`/v1/projects/${projectId}/blobs/complete`, {
      uploadIds: plan.uploads.map((upload) => upload.uploadId),
    });
    if (completion.failed.length > 0) {
      const pathFor = new Map(plan.uploads.map((upload) => [upload.uploadId, byBlob.get(upload.sha256)?.path ?? upload.sha256]));
      const failures = completion.failed.map((failure) => ({ path: pathFor.get(failure.uploadId), reason: failure.reason }));
      throw new CliError('upload_failed', `${failures.length} upload(s) could not be verified`, {
        hint: failures.some((failure) => failure.reason === 'storage_full')
          ? "The project owner's storage is full. Delete projects or upgrade the plan in Account settings on gigacad.site."
          : failures.some((failure) => failure.reason === 'checksum_mismatch')
            ? 'A file changed while it was uploading. Save and close it, then commit again.'
            : 'Commit again; files that already uploaded are not sent twice.',
        details: failures,
      });
    }
    uploaded += completion.completed.length;
  }
  return { uploaded, alreadyPresent, bytes };
}

/** PUT with a known length (presigned storage URLs reject chunked uploads). The URL is never included in errors. */
async function putFile(url: string, headers: Readonly<Record<string, string>>, source: UploadSource): Promise<void> {
  const target = new URL(url);
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = send(target, { method: 'PUT', headers: { ...headers, 'content-length': String(source.size) } }, resolve);
    req.on('error', reject);
    pipeline(createReadStream(source.absolutePath), req).catch(reject);
  }).catch((error: NodeJS.ErrnoException) => {
    throw new CliError('upload_failed', `Uploading ${source.path} failed${error.code ? ` (${error.code})` : ''}`, {
      hint: 'Commit again; files that already uploaded are not sent twice.',
    });
  });
  const body = await readBody(response);
  if (response.statusCode === undefined || response.statusCode >= 300) {
    const storageCode = body.match(/<Code>([^<]+)<\/Code>/)?.[1];
    throw new CliError('upload_failed', `Storage rejected ${source.path} (HTTP ${response.statusCode}${storageCode ? `, ${storageCode}` : ''})`, {
      hint: storageCode === 'AccessDenied' || storageCode === 'RequestTimeTooSkewed' || storageCode === 'ExpiredToken'
        ? 'The upload link expired or your clock is off. Commit again.'
        : 'Commit again; files that already uploaded are not sent twice.',
    });
  }
}

async function readBody(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export interface DownloadTarget {
  readonly blob: string;
  readonly path: string;
  readonly absolutePath: string;
}

/**
 * Downloads each blob once into `tempDir`, checks its SHA-256, and returns the verified
 * temp files by blob. Callers move them into place, so a failed download changes nothing.
 */
export async function downloadBlobs(
  api: Api,
  projectId: string,
  targets: readonly DownloadTarget[],
  tempDir: string,
  progress: (message: string) => void,
): Promise<Map<string, string>> {
  await mkdir(tempDir, { recursive: true });
  const pathFor = new Map(targets.map((target) => [target.blob, target.path]));
  const blobs = [...pathFor.keys()];
  const files = new Map<string, string>();

  try {
    for (let start = 0; start < blobs.length; start += TRANSFER_BATCH) {
      const batch = blobs.slice(start, start + TRANSFER_BATCH);
      const plan = await api.post<DownloadPlan>(`/v1/projects/${projectId}/blobs/downloads`, { sha256s: batch });
      if (plan.missing.length > 0) {
        throw new CliError('download_failed', 'The API is missing some files for this snapshot', {
          details: { paths: plan.missing.map((sha) => pathFor.get(sha) ?? sha) },
        });
      }
      await mapLimit(plan.downloads, CONCURRENCY, async (download) => {
        const path = pathFor.get(download.sha256) ?? download.sha256;
        progress(`Downloading ${path}`);
        const temp = join(tempDir, `${download.sha256}.${randomBytes(4).toString('hex')}`);
        await fetchVerified(download.url, download.sha256, temp, path);
        files.set(download.sha256, temp);
      });
    }
  } catch (error) {
    await Promise.all([...files.values()].map((file) => rm(file, { force: true })));
    throw error;
  }
  return files;
}

async function fetchVerified(url: string, sha256: string, temp: string, path: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new CliError('download_failed', `Downloading ${path} failed`, { hint: 'Check your connection and run the command again.' });
  }
  if (!response.ok || !response.body) {
    throw new CliError('download_failed', `Storage refused ${path} (HTTP ${response.status})`, { hint: 'Run the command again.' });
  }
  const hash = createHash('sha256');
  const hasher = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), hasher, createWriteStream(temp));
  const actual = hash.digest('hex');
  if (actual !== sha256) {
    await rm(temp, { force: true });
    throw new CliError('download_corrupt', `${path} did not match its checksum after downloading`, { hint: 'Run the command again.' });
  }
}

/** Moves verified temp files into place, copying when several paths share one blob. */
export async function placeDownloads(targets: readonly DownloadTarget[], files: ReadonlyMap<string, string>): Promise<void> {
  const remaining = new Map<string, number>();
  for (const target of targets) remaining.set(target.blob, (remaining.get(target.blob) ?? 0) + 1);
  for (const target of targets) {
    const temp = files.get(target.blob);
    if (!temp) throw new CliError('download_failed', `No download for ${target.path}`);
    await mkdir(dirname(target.absolutePath), { recursive: true });
    const left = (remaining.get(target.blob) ?? 1) - 1;
    remaining.set(target.blob, left);
    if (left === 0) await rename(temp, target.absolutePath);
    else await copyFile(temp, target.absolutePath);
  }
}
