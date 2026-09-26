import { parentPort } from 'node:worker_threads';
import { makeThumbnail, UnreadableFile, type ThumbnailFormat } from './index.js';

parentPort?.on('message', async ({ id, bytes, format }: { id: number; bytes: Uint8Array; format: ThumbnailFormat }) => {
  try {
    const png = await makeThumbnail(bytes, format);
    parentPort?.postMessage({ id, png });
  } catch (error) {
    parentPort?.postMessage({ id, error: error instanceof UnreadableFile ? error.message : 'This file couldn’t be read.' });
  }
});
