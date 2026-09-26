import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from './config.js';

export interface PresignedUpload {
  readonly url: string;
  readonly method: 'PUT';
  /** Headers the client must send with the upload; the checksum header makes storage reject altered bytes. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface StoredObject {
  readonly size: number;
  /** Base64 SHA-256 recorded by storage, if it verified one. */
  readonly checksumSha256: string | undefined;
}

/** R2 in production, SeaweedFS locally. Blobs live at a key derived from their SHA-256. */
export interface BlobStorage {
  presignUpload(key: string, sha256: string): Promise<PresignedUpload>;
  /** `filename` makes browsers save the download under that name instead of the blob key. */
  presignDownload(key: string, filename?: string): Promise<string>;
  stat(key: string): Promise<StoredObject | null>;
  copy(fromKey: string, toKey: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Reads a whole object; for the server's own work, like making thumbnails. */
  read(key: string): Promise<Uint8Array>;
  write(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export const MAX_SINGLE_UPLOAD_BYTES = 5 * 1024 ** 3;
const URL_LIFETIME_SECONDS = 60 * 60;

export const blobKey = (sha256: string) => `blobs/${sha256.slice(0, 2)}/${sha256}`;
export const stagingKey = (uploadId: string) => `uploads/${uploadId}`;
export const thumbnailKey = (sha256: string) => `thumbnails/${sha256.slice(0, 2)}/${sha256}.png`;
export const sha256Base64 = (sha256: string) => Buffer.from(sha256, 'hex').toString('base64');

/** An attachment header that survives any file name: an ASCII fallback plus the exact UTF-8 name (RFC 6266). */
export function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function createS3Storage(config: Config): BlobStorage {
  const bucket = config.S3_BUCKET;
  const client = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
    // The SDK's automatic CRC32 checksums break presigned URLs on R2 and other S3 servers; we sign SHA-256 ourselves.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return {
    async presignUpload(key, sha256) {
      const checksum = sha256Base64(sha256);
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ChecksumSHA256: checksum }), {
        expiresIn: URL_LIFETIME_SECONDS,
        unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
      });
      return { url, method: 'PUT', headers: { 'x-amz-checksum-sha256': checksum } };
    },

    presignDownload(key, filename) {
      const disposition = filename ? contentDisposition(filename) : undefined;
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: disposition }), {
        expiresIn: URL_LIFETIME_SECONDS,
      });
    },

    async stat(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: 'ENABLED' }));
        return { size: head.ContentLength ?? 0, checksumSha256: head.ChecksumSHA256?.split('-')[0] };
      } catch (error) {
        if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') return null;
        throw error;
      }
    },

    async copy(fromKey, toKey) {
      await client.send(new CopyObjectCommand({ Bucket: bucket, Key: toKey, CopySource: `${bucket}/${fromKey}` }));
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async read(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error(`Empty object ${key}`);
      return response.Body.transformToByteArray();
    },

    async write(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
  };
}
