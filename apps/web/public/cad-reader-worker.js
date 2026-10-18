// The 3D preview's STEP and IGES reader: OpenCascade compiled to WebAssembly (occt-import-js,
// copied into /vendor/occt/ by scripts/vendor-occt.mjs), run off the page. It replaces the
// package's own worker so every failure is reported, a wasm that won't load included, rather
// than leaving the preview waiting. One file per worker; the page terminates it to cancel.
//
// In:  { format: 'step' | 'iges', buffer: Uint8Array }
// Out: { type: 'ready' } once the reader has loaded, then
//      { type: 'result', meshes: [{ position: Float32Array, normal?: Float32Array, index?: Uint32Array }] }
//      or { type: 'failed', stage: 'load' | 'read', error: string }
'use strict';

const VENDOR = '/vendor/occt/';
let ready = false;
let failed = false;

function fail(stage, error) {
  if (failed) return;
  failed = true;
  postMessage({ type: 'failed', stage, error: String((error && error.message) || error) });
}

let reader;
try {
  importScripts(VENDOR + 'occt-import-js.js');
  reader = occtimportjs({
    locateFile: (path) => VENDOR + path,
    onAbort: (reason) => fail(ready ? 'read' : 'load', reason),
  });
} catch (error) {
  reader = Promise.reject(error);
}
reader.then(
  () => {
    ready = true;
    postMessage({ type: 'ready' });
  },
  (error) => fail('load', error),
);

// The wasm loader can also reject promises nobody awaits.
self.addEventListener('unhandledrejection', (event) => fail(ready ? 'read' : 'load', event.reason));

self.onmessage = async (event) => {
  let occt;
  try {
    occt = await reader;
  } catch {
    return; // Already reported.
  }
  try {
    const { format, buffer } = event.data;
    const result = occt.ReadFile(format, buffer, null);
    if (!result || !result.success) return fail('read', 'unreadable');
    const meshes = [];
    const transfer = [];
    for (const mesh of result.meshes) {
      const out = { position: Float32Array.from(mesh.attributes.position.array) };
      if (mesh.attributes.normal) out.normal = Float32Array.from(mesh.attributes.normal.array);
      if (mesh.index) out.index = Uint32Array.from(mesh.index.array);
      for (const array of [out.position, out.normal, out.index]) if (array) transfer.push(array.buffer);
      meshes.push(out);
    }
    postMessage({ type: 'result', meshes }, transfer);
  } catch (error) {
    fail('read', error);
  }
};
