// `pnpm dist`: icons → build → electron-builder → package check.
//   macOS:   dist/GigaCAD-<v>-universal.dmg
//   Windows: dist/GigaCAD-Setup-<v>.exe (built on Windows; icons come from a Mac, see below)
//
//   node scripts/dist.mjs [--dir] [--arch universal|x64|arm64] [--skip-build] [--allow-missing-icons]
//
// --dir stops at the unpacked app (no DMG or installer). A single --arch is faster for local testing.
// Icons are rendered on a Mac (scripts/icons.mjs). On Windows, build/ must already hold them (the
// release workflow brings them from its Mac job); --allow-missing-icons packages without them, for CI.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { root } from './lib.mjs';

const { values } = parseArgs({
  // `pnpm dist -- --dir` passes the `--` along.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    dir: { type: 'boolean', default: false },
    arch: { type: 'string' },
    'skip-build': { type: 'boolean', default: false },
    'allow-missing-icons': { type: 'boolean', default: false },
  },
});
const windows = process.platform === 'win32';
if (process.platform !== 'darwin' && !windows) {
  console.error('GigaCAD is packaged on macOS (the DMG) or Windows (the installer).');
  process.exit(1);
}
const node = (script, ...args) => execFileSync(process.execPath, [join(root, 'scripts', script), ...args], { stdio: 'inherit' });

if (!values['skip-build']) {
  if (!windows) node('icons.mjs');
  node('build.mjs');
}
const appIcon = join(root, 'build', 'app-icon.png');
if (!existsSync(appIcon) && !values['allow-missing-icons']) throw new Error('build/app-icon.png is missing; run `pnpm icons` on a Mac');

const { build, Platform, Arch } = await import('electron-builder');
await build({
  projectDir: root,
  targets: windows
    ? Platform.WINDOWS.createTarget(values.dir ? 'dir' : 'nsis', Arch[values.arch ?? 'x64'])
    : Platform.MAC.createTarget(values.dir ? 'dir' : 'dmg', Arch[values.arch ?? 'universal']),
  // Merged over electron-builder.yml.
  config: windows && existsSync(appIcon) ? { win: { icon: 'build/app-icon.png' } } : undefined,
  publish: 'never',
});
node('check-package.mjs', ...(values['allow-missing-icons'] ? ['--allow-missing-icons'] : []));
