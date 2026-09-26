import { finishUpload, startUpload } from '../app/(product)/actions';

/** Browsers hash a file in memory before uploading it, so very large files go through the drive or CLI instead. */
export const MAX_BROWSER_UPLOAD_BYTES = 2 * 1024 ** 3;

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Uploads a file's contents into a project from the browser, the same way the CLI does:
 * hash it, send the bytes straight to storage, and let the API verify them. Returns the
 * contents' hash, for adding the file to a folder or as a new revision.
 */
export async function uploadContents(projectId: string, file: File): Promise<{ sha256?: string; error?: string }> {
  if (file.size > MAX_BROWSER_UPLOAD_BYTES) return { error: `${file.name} is over 2 GB, the most the browser can upload.` };
  const sha256 = await sha256Hex(file);
  const started = await startUpload(projectId, sha256, file.size);
  if (started.error) return { error: started.error };
  if (started.upload) {
    const response = await fetch(started.upload.url, { method: 'PUT', headers: started.upload.headers, body: file }).catch(() => null);
    if (!response?.ok) return { error: `${file.name} didn’t upload. Check your connection and try again.` };
    const finished = await finishUpload(projectId, started.upload.uploadId);
    if (finished.error) return { error: finished.error };
  }
  return { sha256 };
}
