// Checks a packaged GigaCAD.app: nothing it would need a Node install or native modules for,
// and a built-in code bundle the app's own bootstrap will accept.
//
//   node scripts/check-package.mjs [path/to/GigaCAD.app]   (default: the newest in dist/)
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { importTs, root, signingKey } from './lib.mjs';

function newestApp() {
  const dist = join(root, 'dist');
  const apps = readdirSync(dist)
    .filter((name) => name.startsWith('mac'))
    .map((name) => join(dist, name, 'GigaCAD.app'))
    .filter(existsSync)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!apps[0]) throw new Error('No GigaCAD.app in dist/; run `pnpm dist` first');
  return apps[0];
}

const app = process.argv[2] ?? newestApp();
const resources = join(app, 'Contents', 'Resources');
const problems = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    // The Electron framework is the runtime itself; everything else is ours.
    if (entry.name === 'Frameworks' && dir.endsWith('Contents')) continue;
    if (entry.isDirectory() && entry.name === 'node_modules') problems.push(`node_modules in the app: ${path}`);
    else if (entry.isFile() && entry.name.endsWith('.node')) problems.push(`native module: ${path}`);
    if (entry.isDirectory()) walk(path);
  }
}
walk(join(app, 'Contents'));

if (!existsSync(join(app, 'Contents', 'MacOS', 'GigaCAD'))) problems.push('Contents/MacOS/GigaCAD is missing (the terminal shim runs it)');
if (!existsSync(join(resources, 'cli-launcher.cjs'))) problems.push('Resources/cli-launcher.cjs is missing');
if (!existsSync(join(resources, 'app', 'out', 'shell', 'bootstrap.cjs'))) problems.push('the bootstrap is missing');

const bundle = join(resources, 'app-bundle');
const { verifyBundle } = await importTs('src/shared/bundle.ts');
const result = verifyBundle(bundle, signingKey().publicKey);
if (!result.ok) problems.push(`Resources/app-bundle doesn't verify: ${result.reason}`);
else {
  if (!result.manifest.files['cli/giga.js']) problems.push('the bundle has no cli/giga.js');
  if (!Object.keys(result.manifest.files).some((file) => file.startsWith('icons/') && file.endsWith('.png'))) problems.push('the bundle has no icons');
}

if (problems.length > 0) {
  console.error(`${app} isn't ready to ship:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`${app} checks out: bundle ${result.manifest.version} for shell ${result.manifest.shellMin}, ${Object.keys(result.manifest.files).length} files, no node_modules or native modules.`);
