// Copies OpenCascade's WebAssembly STEP/IGES reader into public/ so the 3D viewer can load
// it from our own origin, on demand. It's 7.6 MB, so it isn't committed.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const dist = join(dirname(createRequire(import.meta.url).resolve('occt-import-js/package.json')), 'dist');
const target = new URL('../public/vendor/occt/', import.meta.url).pathname;
mkdirSync(target, { recursive: true });
for (const file of ['occt-import-js.js', 'occt-import-js.wasm', 'occt-import-js-worker.js', 'license.occt.txt', 'license.occt-import-js.txt']) {
  copyFileSync(join(dist, file), join(target, file));
}
