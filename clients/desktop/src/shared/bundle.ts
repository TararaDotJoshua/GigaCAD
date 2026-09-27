import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

/**
 * A code bundle: everything of the app except the Electron runtime and the bootstrap.
 * `bundle.json` lists every file with its SHA-256; `bundle.sig` is a detached Ed25519
 * signature over the exact bytes of `bundle.json`.
 */
export interface BundleManifest {
  readonly version: string;
  /** The oldest shell (Electron runtime + bootstrap) this bundle runs on. */
  readonly shellMin: number;
  readonly createdAt: string;
  readonly files: Readonly<Record<string, string>>;
}

export const MANIFEST_FILE = 'bundle.json';
export const SIGNATURE_FILE = 'bundle.sig';

/** Files every bundle must have; the bootstrap loads them by these names. */
export const REQUIRED_FILES = ['main/index.cjs', 'preload/index.cjs', 'renderer/index.html', 'cli/giga.js'] as const;

export type VerifyResult = { readonly ok: true; readonly manifest: BundleManifest } | { readonly ok: false; readonly reason: string };

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Every regular file under `dir`, as forward-slash paths, sorted. */
export function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(dir, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

function safeRelative(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.includes('\\') && posix.normalize(path) === path && !path.split('/').includes('..');
}

/** Checks the signature against `publicKeyPem`, then every listed file's hash. Never throws. */
export function verifyBundle(dir: string, publicKeyPem: string): VerifyResult {
  try {
    const manifestPath = join(dir, MANIFEST_FILE);
    const signaturePath = join(dir, SIGNATURE_FILE);
    if (!existsSync(manifestPath) || !existsSync(signaturePath)) return { ok: false, reason: 'unsigned' };
    const bytes = readFileSync(manifestPath);
    const signature = Buffer.from(readFileSync(signaturePath, 'utf8').trim(), 'base64');
    if (!verify(null, bytes, createPublicKey(publicKeyPem), signature)) return { ok: false, reason: 'bad signature' };

    const manifest = JSON.parse(bytes.toString('utf8')) as BundleManifest;
    if (typeof manifest.version !== 'string' || !Number.isInteger(manifest.shellMin) || typeof manifest.files !== 'object') {
      return { ok: false, reason: 'malformed manifest' };
    }
    for (const required of REQUIRED_FILES) if (!(required in manifest.files)) return { ok: false, reason: `missing ${required}` };
    for (const [path, expected] of Object.entries(manifest.files)) {
      if (!safeRelative(path)) return { ok: false, reason: `unsafe path ${path}` };
      const absolute = join(dir, ...path.split('/'));
      if (!existsSync(absolute) || !statSync(absolute).isFile()) return { ok: false, reason: `missing ${path}` };
      if (sha256(readFileSync(absolute)) !== expected) return { ok: false, reason: `changed ${path}` };
    }
    return { ok: true, manifest };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Builds the manifest for a finished bundle folder (build time). */
export function manifestFor(dir: string, version: string, shellMin: number): BundleManifest {
  const files: Record<string, string> = {};
  for (const path of listFiles(dir)) {
    if (path === MANIFEST_FILE || path === SIGNATURE_FILE) continue;
    files[path] = sha256(readFileSync(join(dir, ...path.split('/'))));
  }
  return { version, shellMin, createdAt: new Date().toISOString(), files };
}

export function signBytes(bytes: Buffer | string, privateKeyPem: string): string {
  return sign(null, Buffer.from(bytes), createPrivateKey(privateKeyPem)).toString('base64');
}

export function verifyBytes(bytes: Buffer | string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    return verify(null, Buffer.from(bytes), createPublicKey(publicKeyPem), Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

/** Compares dotted numeric versions ("0.10.2" > "0.9.9"). Anything after "-" is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('-')[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
