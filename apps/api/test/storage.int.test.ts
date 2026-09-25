import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createS3Storage, sha256Base64 } from '../src/storage.js';
import { sha256 } from './helpers.js';

// Runs against SeaweedFS from `docker compose up` (the local stand-in for R2), or R2 itself through S3_* variables.
const storage = createS3Storage(
  loadConfig({
    DATABASE_URL: 'postgresql://unused@localhost/unused',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
    S3_REGION: process.env.S3_REGION ?? 'us-east-1',
    S3_BUCKET: process.env.S3_BUCKET ?? 'gigacad',
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'gigacad',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'gigacad-local-secret',
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? 'true',
  }),
);

describe('S3 blob storage', () => {
  it('accepts an upload only with the signed checksum and matching bytes', async () => {
    const content = `bracket ${randomUUID()}`;
    const hash = sha256(content);
    const key = `uploads/${randomUUID()}`;
    const upload = await storage.presignUpload(key, hash);

    const forged = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: `${content.slice(0, -1)}!` });
    expect(forged.ok).toBe(false);
    expect(await storage.stat(key)).toBeNull();

    const unsigned = await fetch(upload.url, { method: 'PUT', body: content });
    expect(unsigned.ok).toBe(false);

    const accepted = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: content });
    expect(accepted.status).toBe(200);
    expect(await storage.stat(key)).toEqual({ size: Buffer.byteLength(content), checksumSha256: sha256Base64(hash) });

    const blob = `blobs/${hash.slice(0, 2)}/${hash}`;
    await storage.copy(key, blob);
    await storage.remove(key);
    expect(await storage.stat(key)).toBeNull();

    const download = await fetch(await storage.presignDownload(blob));
    expect(await download.text()).toBe(content);

    const named = await fetch(await storage.presignDownload(blob, 'Rear arm (v2) ü.SLDPRT'));
    expect(named.headers.get('content-disposition')).toBe(
      `attachment; filename="Rear arm (v2) _.SLDPRT"; filename*=UTF-8''Rear%20arm%20%28v2%29%20%C3%BC.SLDPRT`,
    );
    await storage.remove(blob);
  });
});
