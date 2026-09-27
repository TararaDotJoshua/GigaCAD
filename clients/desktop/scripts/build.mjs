// Builds the app into out/:
//   out/shell/   bootstrap.cjs (the app's entry) and cli-launcher.cjs: change only with a new DMG
//   out/bundle/  the code bundle: main, preload, renderer, the giga CLI, and icons, signed
//
// Usage: node scripts/build.mjs [--skip-renderer]
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { bundleOut, iconsBuild, nodeBuild, out, pkg, root, shellOut, shellVersion, signingKey, writeSignedManifest } from './lib.mjs';

const key = signingKey();
if (key.devPublicKey) console.warn('Signing with a local development key: this build only accepts bundles signed on this computer.');

rmSync(out, { recursive: true, force: true });
mkdirSync(shellOut, { recursive: true });

// The shell. Its public key decides which bundles it will ever run.
const shellDefine = key.devPublicKey ? { __GIGACAD_DEV_PUBLIC_KEY__: JSON.stringify(key.devPublicKey) } : {};
await build({ ...nodeBuild, entryPoints: [join(root, 'src/bootstrap/index.ts')], outfile: join(shellOut, 'bootstrap.cjs'), define: shellDefine });
await build({ ...nodeBuild, entryPoints: [join(root, 'src/bootstrap/cli-launcher.ts')], outfile: join(shellOut, 'cli-launcher.cjs'), define: shellDefine });

// The code bundle.
const define = { __GIGACAD_VERSION__: JSON.stringify(pkg.version) };
await build({ ...nodeBuild, entryPoints: [join(root, 'src/main/index.ts')], outfile: join(bundleOut, 'main', 'index.cjs'), define });
await build({ ...nodeBuild, entryPoints: [join(root, 'src/preload/index.ts')], outfile: join(bundleOut, 'preload', 'index.cjs'), sourcemap: false });

// The same single-file giga the npm package ships.
execFileSync(process.execPath, [join(root, '..', 'cli', 'scripts', 'build.mjs')], { stdio: 'inherit' });
mkdirSync(join(bundleOut, 'cli'), { recursive: true });
cpSync(join(root, '..', 'cli', 'dist', 'giga.js'), join(bundleOut, 'cli', 'giga.js'));

if (!process.argv.includes('--skip-renderer')) {
  await viteBuild({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
}

// Icons are drawn with macOS's own SVG renderer, so they're made on a Mac (`pnpm icons`).
if (existsSync(iconsBuild) && readdirSync(iconsBuild).length > 0) {
  cpSync(iconsBuild, join(bundleOut, 'icons'), { recursive: true });
} else {
  console.warn('No pre-rendered icons in build/icons; run `pnpm --filter @gigacad/desktop icons` on a Mac. Finder icons are missing from this build.');
}

const manifest = await writeSignedManifest(bundleOut, pkg.version, shellVersion(), key.privateKey);
writeFileSync(join(out, 'build.json'), `${JSON.stringify({ version: pkg.version, shellVersion: shellVersion(), files: Object.keys(manifest.files).length, devKey: Boolean(key.devPublicKey) }, null, 2)}\n`);
console.log(`Built bundle ${pkg.version} (${Object.keys(manifest.files).length} files) for shell ${shellVersion()}.`);
