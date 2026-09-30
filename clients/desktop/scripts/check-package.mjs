// Checks a packaged GigaCAD: nothing it would need a Node install or native modules for, and a
// built-in code bundle the app's own bootstrap will accept.
//
//   node scripts/check-package.mjs [path/to/GigaCAD.app | path/to/win-unpacked] [--allow-missing-icons]
//   (default: the newest GigaCAD.app, or dist/win-unpacked on Windows)
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { importTs, root, signingKey } from './lib.mjs';

const args = process.argv.slice(2);
const allowMissingIcons = args.includes('--allow-missing-icons');
const given = args.find((arg) => !arg.startsWith('--'));

function newestApp() {
  const dist = join(root, 'dist');
  if (process.platform === 'win32') {
    const unpacked = join(dist, 'win-unpacked');
    if (!existsSync(unpacked)) throw new Error('No dist/win-unpacked; run `pnpm dist` first');
    return unpacked;
  }
  const apps = readdirSync(dist)
    .filter((name) => name.startsWith('mac'))
    .map((name) => join(dist, name, 'GigaCAD.app'))
    .filter(existsSync)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!apps[0]) throw new Error('No GigaCAD.app in dist/; run `pnpm dist` first');
  return apps[0];
}

const app = given ?? newestApp();
const windows = !app.endsWith('.app');
// macOS: GigaCAD.app/Contents/{MacOS,Resources}. Windows: win-unpacked/{GigaCAD.exe,resources}.
const top = windows ? app : join(app, 'Contents');
const resources = windows ? join(app, 'resources') : join(top, 'Resources');
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
walk(windows ? resources : top);

const binary = windows ? join(app, 'GigaCAD.exe') : join(top, 'MacOS', 'GigaCAD');
if (!existsSync(binary)) problems.push(`${windows ? 'GigaCAD.exe' : 'Contents/MacOS/GigaCAD'} is missing (the terminal shim runs it)`);
if (!existsSync(join(resources, 'cli-launcher.cjs'))) problems.push('resources/cli-launcher.cjs is missing');
if (!existsSync(join(resources, 'app', 'out', 'shell', 'bootstrap.cjs'))) problems.push('the bootstrap is missing');

const bundle = join(resources, 'app-bundle');
const { verifyBundle } = await importTs('src/shared/bundle.ts');
const result = verifyBundle(bundle, signingKey().publicKey);
if (!result.ok) problems.push(`resources/app-bundle doesn't verify: ${result.reason}`);
else {
  if (!result.manifest.files['cli/giga.js']) problems.push('the bundle has no cli/giga.js');
  const hasIcons = Object.keys(result.manifest.files).some((file) => file.startsWith('icons/') && file.endsWith('.png'));
  if (!hasIcons && !allowMissingIcons) problems.push('the bundle has no icons');
  if (!hasIcons && allowMissingIcons) console.warn('The bundle has no icons (allowed with --allow-missing-icons).');
}

if (problems.length > 0) {
  console.error(`${app} isn't ready to ship:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`${app} checks out: bundle ${result.manifest.version} for shell ${result.manifest.shellMin}, ${Object.keys(result.manifest.files).length} files, no node_modules or native modules.`);
