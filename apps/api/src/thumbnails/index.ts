import { Worker } from 'node:worker_threads';
import { parseModel, UnreadableFile, type MeshFormat } from './parse.js';
import { encodePng } from './png.js';
import { renderMesh, THUMBNAIL_SIZE } from './render.js';
import { fitPreview, readSolidWorksPreview } from './solidworks.js';

export { UnreadableFile } from './parse.js';
export { THUMBNAIL_SIZE } from './render.js';

/** Mesh and CAD formats are drawn from their geometry; SolidWorks files use the picture saved inside them. */
export type ThumbnailFormat = MeshFormat | 'solidworks';

/** Turns a model file into a PNG thumbnail. Throws `UnreadableFile` for files that can't be drawn. */
export async function makeThumbnail(bytes: Uint8Array, format: ThumbnailFormat): Promise<Uint8Array> {
  const pixels =
    format === 'solidworks' ? fitPreview(readSolidWorksPreview(bytes), THUMBNAIL_SIZE) : renderMesh(await parseModel(bytes, format));
  return encodePng(THUMBNAIL_SIZE, THUMBNAIL_SIZE, pixels);
}

export interface ThumbnailRenderer {
  render(bytes: Uint8Array, format: ThumbnailFormat): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** Renders in-process. For tests; the server uses a worker thread. */
export const inlineRenderer: ThumbnailRenderer = { render: makeThumbnail, close: async () => {} };

/** A big STEP file can take a while to tessellate, but not this long. */
const RENDER_TIMEOUT_MS = 120_000;

/**
 * Renders in a worker thread, so a heavy file never stalls requests. Closing the worker
 * frees OpenCascade's memory, which WebAssembly otherwise keeps for good.
 */
export function workerRenderer(): ThumbnailRenderer {
  // Built code runs worker.js; `tsx` (dev) runs the TypeScript source.
  const fromSource = import.meta.url.endsWith('.ts');
  const entry = new URL(fromSource ? './worker.ts' : './worker.js', import.meta.url);
  let worker: Worker | undefined;
  let next = 0;

  const stop = async () => {
    const current = worker;
    worker = undefined;
    await current?.terminate();
  };

  return {
    render(bytes, format) {
      worker ??= new Worker(entry, { execArgv: fromSource ? ['--import', 'tsx'] : [] });
      const current = worker;
      const id = next++;
      return new Promise<Uint8Array>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer);
          current.off('message', onMessage);
          current.off('error', onError);
          current.off('exit', onExit);
        };
        const fail = (message: string) => {
          done();
          // A worker that timed out or crashed may be in any state; start a fresh one next time.
          if (worker === current) void stop();
          reject(new UnreadableFile(message));
        };
        const onMessage = (message: { id: number; png?: Uint8Array; error?: string }) => {
          if (message.id !== id) return;
          done();
          if (message.png) resolve(message.png);
          else reject(new UnreadableFile(message.error ?? 'This file couldn’t be read.'));
        };
        const onError = () => fail('This file is too large or complex to preview.');
        const onExit = () => fail('This file is too large or complex to preview.');
        const timer = setTimeout(() => fail('This file took too long to preview.'), RENDER_TIMEOUT_MS);
        current.on('message', onMessage);
        current.on('error', onError);
        current.on('exit', onExit);
        current.postMessage({ id, bytes, format });
      });
    },
    close: stop,
  };
}
