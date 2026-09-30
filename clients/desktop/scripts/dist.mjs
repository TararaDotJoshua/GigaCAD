// `pnpm dist`: icons → build → electron-builder → package check. Makes dist/GigaCAD-<v>-universal.dmg.
//
//   node scripts/dist.mjs [--dir] [--arch universal|x64|arm64] [--skip-build]
//
// --dir stops at dist/mac*/GigaCAD.app (no DMG). A single --arch is faster for local testing.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { root } from './lib.mjs';

const { values } = parseArgs({
  // `pnpm dist -- --dir` passes the `--` along.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { dir: { type: 'boolean', default: false }, arch: { type: 'string', default: 'universal' }, 'skip-build': { type: 'boolean', default: false } },
});
if (process.platform !== 'darwin') {
  console.error('The macOS app is packaged on a Mac.');
  process.exit(1);
}
const node = (script, ...args) => execFileSync(process.execPath, [join(root, 'scripts', script), ...args], { stdio: 'inherit' });

if (!values['skip-build']) {
  node('icons.mjs');
  node('build.mjs');
}
if (!existsSync(join(root, 'build', 'app-icon.png'))) throw new Error('build/app-icon.png is missing; run `pnpm icons`');

const { build, Platform, Arch } = await import('electron-builder');
await build({
  projectDir: root,
  targets: Platform.MAC.createTarget(values.dir ? 'dir' : 'dmg', Arch[values.arch]),
  publish: 'never',
});
node('check-package.mjs');
