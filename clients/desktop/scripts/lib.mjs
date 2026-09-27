// Shared by the build, dist, and release scripts.
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const out = join(root, 'out');
export const shellOut = join(out, 'shell');
export const bundleOut = join(out, 'bundle');
export const iconsBuild = join(root, 'build', 'icons');
export const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** esbuild options for the Node side (bootstrap, main, preload): one CommonJS file each. */
export const nodeBuild = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  conditions: ['@gigacad/source'],
  legalComments: 'none',
  logLevel: 'warning',
  sourcemap: 'linked',
};

/** SHELL_VERSION from src/bootstrap/shell.ts. */
export function shellVersion() {
  const match = readFileSync(join(root, 'src', 'bootstrap', 'shell.ts'), 'utf8').match(/SHELL_VERSION = (\d+)/);
  if (!match) throw new Error('SHELL_VERSION not found in src/bootstrap/shell.ts');
  return Number(match[1]);
}

/** The public key compiled into src/bootstrap/publicKey.ts. */
export function productionPublicKey() {
  const match = readFileSync(join(root, 'src', 'bootstrap', 'publicKey.ts'), 'utf8').match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----\n?/);
  if (!match) throw new Error('No public key in src/bootstrap/publicKey.ts');
  return match[0].endsWith('\n') ? match[0] : `${match[0]}\n`;
}

/**
 * The key that signs bundles: DESKTOP_UPDATE_KEY (PEM text, in CI), GIGACAD_UPDATE_KEY_FILE,
 * or the owner's backup at ~/.config/gigacad/desktop-update-key.pem. Without one, a throwaway
 * key in .keys/ signs the build, and `devPublicKey` is compiled into its shell instead, so
 * that build only accepts bundles signed on this computer.
 */
export function signingKey() {
  let pem = process.env.DESKTOP_UPDATE_KEY?.trim();
  const file = process.env.GIGACAD_UPDATE_KEY_FILE ?? join(homedir(), '.config', 'gigacad', 'desktop-update-key.pem');
  if (!pem && existsSync(file)) pem = readFileSync(file, 'utf8');
  if (pem) {
    const publicKey = createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'pem' });
    const production = publicKey.trim() === productionPublicKey().trim();
    return { privateKey: pem, publicKey, devPublicKey: production ? undefined : publicKey };
  }
  const dir = join(root, '.keys');
  const devFile = join(dir, 'dev-update-key.pem');
  if (!existsSync(devFile)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const { privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(devFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  const privateKey = readFileSync(devFile, 'utf8');
  const publicKey = createPublicKey(createPrivateKey(privateKey)).export({ type: 'spki', format: 'pem' });
  return { privateKey, publicKey, devPublicKey: publicKey };
}

/** Imports a TypeScript module from src/ by compiling it with esbuild first (scripts run on plain Node). */
export async function importTs(relativePath) {
  const { build } = await import('esbuild');
  const outfile = join(root, 'node_modules', '.cache', 'gigacad-scripts', `${relativePath.replace(/[\\/]/g, '_')}.mjs`);
  await build({
    entryPoints: [join(root, relativePath)],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    conditions: ['@gigacad/source'],
    logLevel: 'warning',
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

/** Writes bundle.json (every file's SHA-256) and bundle.sig (Ed25519 over bundle.json's bytes). */
export async function writeSignedManifest(dir, version, shellMin, privateKey) {
  const { manifestFor, signBytes, MANIFEST_FILE, SIGNATURE_FILE } = await importTs('src/shared/bundle.ts');
  const manifest = manifestFor(dir, version, shellMin);
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(dir, MANIFEST_FILE), bytes);
  writeFileSync(join(dir, SIGNATURE_FILE), `${signBytes(bytes, privateKey)}\n`);
  return manifest;
}
