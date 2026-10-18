import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CAD_READER_LOAD_TIMEOUT_MS, cadReadTimeout, readCadReply, transferables } from './viewer-protocol';

describe('readCadReply', () => {
  it('reads the CAD reader’s messages', () => {
    expect(readCadReply({ type: 'ready' })).toEqual({ kind: 'ready' });
    expect(readCadReply({ type: 'failed', stage: 'load', error: 'Aborted(404)' })).toEqual({ kind: 'failed', problem: 'reader' });
    expect(readCadReply({ type: 'failed', stage: 'read' })).toEqual({ kind: 'failed', problem: 'unreadable' });
    const position = new Float32Array(9);
    expect(readCadReply({ type: 'result', meshes: [{ position }, { position: [1, 2, 3] }] })).toEqual({ kind: 'meshes', meshes: [{ position }] });
  });

  it('treats anything else as an unreadable file', () => {
    expect(readCadReply(null)).toEqual({ kind: 'failed', problem: 'unreadable' });
    expect(readCadReply({ success: true, meshes: [] })).toEqual({ kind: 'failed', problem: 'unreadable' });
  });
});

describe('cadReadTimeout', () => {
  it('allows 90 seconds plus a second per MB', () => {
    expect(CAD_READER_LOAD_TIMEOUT_MS).toBe(90_000);
    expect(cadReadTimeout(0)).toBe(90_000);
    expect(cadReadTimeout(100 * 1024 * 1024)).toBe(190_000);
  });
});

describe('transferables', () => {
  it('lists each buffer once', () => {
    const shared = new ArrayBuffer(36 * 2);
    const position = new Float32Array(shared, 0, 9);
    const normal = new Float32Array(shared, 36, 9);
    const index = new Uint32Array([0, 1, 2]);
    expect(transferables([{ position, normal, index }])).toEqual([shared, index.buffer]);
  });
});

// public/cad-reader-worker.js, run against a stand-in for occt-import-js.
const WORKER = readFileSync(new URL('../public/cad-reader-worker.js', import.meta.url), 'utf8');

interface Reader {
  ReadFile(format: string, buffer: Uint8Array, params: null): unknown;
}

function startWorker(load: (overrides: { onAbort(reason: unknown): void }) => Promise<Reader>, { scriptFails = false } = {}) {
  const messages: Record<string, unknown>[] = [];
  const listeners: Record<string, (event: { reason: unknown }) => void> = {};
  const scope: Record<string, unknown> = {
    Float32Array,
    Uint32Array,
    postMessage: (message: Record<string, unknown>) => messages.push(message),
    addEventListener: (type: string, listener: (event: { reason: unknown }) => void) => {
      listeners[type] = listener;
    },
    importScripts: (url: string) => {
      if (scriptFails) throw new Error(`NetworkError: ${url}`);
      expect(url).toBe('/vendor/occt/occt-import-js.js');
      scope.occtimportjs = load;
    },
  };
  scope.self = scope;
  runInNewContext(WORKER, scope);
  const send = async (data: unknown) => {
    await (scope.onmessage as (event: { data: unknown }) => Promise<void>)({ data });
  };
  return { messages, listeners, send, settle: () => new Promise((resolve) => setTimeout(resolve, 0)) };
}

const occtMesh = { attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] }, normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] } }, index: { array: [0, 1, 2] } };

describe('cad-reader-worker.js', () => {
  it('says when it’s ready, then sends typed arrays', async () => {
    const worker = startWorker(async () => ({ ReadFile: () => ({ success: true, meshes: [occtMesh] }) }));
    await worker.settle();
    expect(worker.messages).toEqual([{ type: 'ready' }]);
    await worker.send({ format: 'step', buffer: new Uint8Array(4) });
    const result = worker.messages[1] as { type: string; meshes: { position: Float32Array; index: Uint32Array }[] };
    expect(result.type).toBe('result');
    expect(result.meshes[0]!.position).toBeInstanceOf(Float32Array);
    expect([...result.meshes[0]!.index]).toEqual([0, 1, 2]);
  });

  it('reports a wasm that fails to load instead of hanging', async () => {
    const worker = startWorker(() => Promise.reject(new Error('Aborted(both async and sync fetching of the wasm failed)')));
    await worker.send({ format: 'step', buffer: new Uint8Array(4) });
    await worker.settle();
    expect(worker.messages).toEqual([{ type: 'failed', stage: 'load', error: 'Aborted(both async and sync fetching of the wasm failed)' }]);
  });

  it('reports a reader script that fails to load', async () => {
    const worker = startWorker(async () => ({ ReadFile: () => null }), { scriptFails: true });
    await worker.settle();
    expect(worker.messages).toMatchObject([{ type: 'failed', stage: 'load' }]);
  });

  it('reports files the reader can’t read, or crashes on, once', async () => {
    const unreadable = startWorker(async () => ({ ReadFile: () => ({ success: false }) }));
    await unreadable.send({ format: 'iges', buffer: new Uint8Array(4) });
    expect(unreadable.messages).toEqual([{ type: 'ready' }, { type: 'failed', stage: 'read', error: 'unreadable' }]);

    let abort: (reason: unknown) => void = () => {};
    const crashing = startWorker(async (overrides) => {
      abort = overrides.onAbort;
      return {
        ReadFile: () => {
          abort('OOM');
          throw new Error('Aborted(OOM)');
        },
      };
    });
    await crashing.send({ format: 'step', buffer: new Uint8Array(4) });
    crashing.listeners.unhandledrejection?.({ reason: new Error('late') });
    expect(crashing.messages).toEqual([{ type: 'ready' }, { type: 'failed', stage: 'read', error: 'OOM' }]);
  });
});
