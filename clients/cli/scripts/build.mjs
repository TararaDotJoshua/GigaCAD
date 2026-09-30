// Bundles the CLI and @gigacad/core into one file, so the published package has no runtime dependencies.
import { chmod, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
// fileURLToPath, not URL.pathname: the latter is /D:/… on Windows, which esbuild can't open.
const outfile = fileURLToPath(new URL('../dist/giga.js', import.meta.url));

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  conditions: ['@gigacad/source'],
  define: { __GIGA_VERSION__: JSON.stringify(pkg.version) },
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __gigaCreateRequire } from 'node:module';\nconst require = __gigaCreateRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});
await chmod(outfile, 0o755);
