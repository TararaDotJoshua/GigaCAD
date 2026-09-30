import { finishUpload, startUpload, type ActionState } from '../app/(product)/actions';

/** Browsers hash a file in memory before uploading it, so very large files go through the drive or CLI instead. */
export const MAX_BROWSER_UPLOAD_BYTES = 2 * 1024 ** 3;

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** PUTs the bytes with XHR rather than fetch, because only XHR reports upload progress. */
function put(url: string, headers: Record<string, string>, file: File, onProgress: (fraction: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    request.onload = () => resolve(request.status >= 200 && request.status < 300);
    request.onerror = () => resolve(false);
    request.send(file);
  });
}

export type UploadPhase = 'hashing' | 'uploading' | 'saving';

/**
 * Uploads a file's contents into a project from the browser, the same way the CLI does:
 * hash it, send the bytes straight to storage, and let the API verify them. Returns the
 * contents' hash, for adding the file to a folder or as a new revision.
 */
export async function uploadContents(
  projectId: string,
  file: File,
  onProgress: (phase: UploadPhase, fraction: number) => void = () => {},
): Promise<{ sha256?: string; error?: string; storageFull?: ActionState['storageFull'] }> {
  if (file.size > MAX_BROWSER_UPLOAD_BYTES) return { error: 'Over 2 GB, the most the browser can upload. Use the GigaCAD app or the CLI.' };
  onProgress('hashing', 0);
  const sha256 = await sha256Hex(file);
  const started = await startUpload(projectId, sha256, file.size);
  if (started.error) return { error: started.error, storageFull: started.storageFull };
  if (started.upload) {
    onProgress('uploading', 0);
    if (!(await put(started.upload.url, started.upload.headers, file, (fraction) => onProgress('uploading', fraction)))) {
      return { error: 'Didn’t upload. Check your connection and try again.' };
    }
    onProgress('saving', 1);
    const finished = await finishUpload(projectId, started.upload.uploadId);
    if (finished.error) return { error: finished.error, storageFull: finished.storageFull };
  }
  onProgress('saving', 1);
  return { sha256 };
}
