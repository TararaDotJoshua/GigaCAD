// Builds a signed update for the desktop-release workflow, in release/:
//   bundle-<version>.tar.gz   the code bundle (out/bundle)
//   manifest.json             signed; tells installed apps where the bundle is
//
//   node scripts/release.mjs [--notes "What changed"] [--notes-url https://…] [--skip-build]
//
// Needs the production key (DESKTOP_UPDATE_KEY or the owner's key file): installed apps
// reject anything else.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { bundleOut, importTs, pkg, root, shellVersion, signingKey } from './lib.mjs';

export const DOWNLOADS = process.env.GIGACAD_DOWNLOADS_URL ?? 'https://downloads.gigacad.site/desktop';
export const CHANNEL = 'stable';

const { values } = parseArgs({
  // `pnpm dist -- --dir` passes the `--` along.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { notes: { type: 'string', default: '' }, 'notes-url': { type: 'string' }, 'skip-build': { type: 'boolean', default: false } },
});

const key = signingKey();
if (key.devPublicKey && !process.env.GIGACAD_ALLOW_DEV_KEY) {
  console.error('Releases must be signed with the production key (DESKTOP_UPDATE_KEY, or ~/.config/gigacad/desktop-update-key.pem).');
  process.exit(1);
}

if (!values['skip-build']) execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
const built = JSON.parse(readFileSync(join(bundleOut, 'bundle.json'), 'utf8'));
if (built.version !== pkg.version) throw new Error(`out/bundle is ${built.version}, but package.json says ${pkg.version}; build again`);

const out = join(root, 'release');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const archiveName = `bundle-${pkg.version}.tar.gz`;
const archive = join(out, archiveName);
// COPYFILE_DISABLE keeps macOS from adding ._ files the bundle's manifest doesn't list.
execFileSync('tar', ['-czf', archive, '-C', bundleOut, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
const bytes = readFileSync(archive);

const { canonicalManifest } = await importTs('src/main/updates.ts');
const { signBytes } = await importTs('src/shared/bundle.ts');
const fields = {
  version: pkg.version,
  shellMin: built.shellMin,
  bundleUrl: `${DOWNLOADS}/${CHANNEL}/bundles/${archiveName}`,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: bytes.length,
  notes: values.notes,
  notesUrl: values['notes-url'] ?? null,
  dmgUrl: `${DOWNLOADS}/GigaCAD.dmg`,
  publishedAt: new Date().toISOString(),
};
const manifest = { ...fields, signature: signBytes(canonicalManifest(fields), key.privateKey) };
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Release ${pkg.version} (bundle for shell ${built.shellMin}+, this shell is ${shellVersion()}): ${archiveName}, ${(bytes.length / 1e6).toFixed(1)} MB`);
