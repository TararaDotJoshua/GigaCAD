import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signBytes, verifyBundle } from '../src/shared/bundle.js';
import type { UpdateState } from '../src/shared/types.js';
import { canonicalManifest, defaultManifestUrl, tarPath, Updater, verifyManifest, type UpdateManifest } from '../src/main/updates.js';
import { keyPair, makeBundle } from './helpers.js';

const key = keyPair();
let temp: string;
let bundlesDir: string;
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'gigacad-updates-'));
  bundlesDir = join(temp, 'bundles');
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

function signed(fields: Omit<UpdateManifest, 'signature'>, privateKey = key.privateKey): UpdateManifest {
  return { ...fields, signature: signBytes(canonicalManifest(fields), privateKey) };
}

/** A release like scripts/release.mjs makes: a bundle archive and its signed manifest. */
function release(version: string, options: { shellMin?: number; tamper?: boolean } = {}) {
  const dir = makeBundle(join(temp, `src-${version}`), version, key.privateKey, options.shellMin ?? 1);
  const archive = join(temp, `bundle-${version}.tar.gz`);
  execFileSync(tarPath(), ['-czf', archive, '-C', dir, '.']);
  const bytes = readFileSync(archive);
  const manifest = signed({
    version,
    shellMin: options.shellMin ?? 1,
    bundleUrl: `https://downloads.example/${version}.tar.gz`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    notes: `What’s new in ${version}`,
    notesUrl: null,
    dmgUrl: 'https://downloads.example/GigaCAD.dmg',
    publishedAt: '2026-09-26T00:00:00Z',
  });
  const served = options.tamper ? Buffer.concat([bytes.subarray(0, -1), Buffer.from([bytes.at(-1)! ^ 1])]) : bytes;
  return { manifest, archive: served };
}

function server(manifest: unknown, archive?: Buffer) {
  return vi.fn(async (url: string | URL | Request) =>
    String(url).endsWith('manifest.json') ? new Response(JSON.stringify(manifest)) : archive ? new Response(new Uint8Array(archive)) : new Response('missing', { status: 404 }),
  ) as unknown as typeof fetch;
}

function updater(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof Updater>[0]> = {}) {
  const states: UpdateState['kind'][] = [];
  const instance = new Updater({
    currentVersion: '1.0.0',
    shellVersion: 1,
    bundlesDir,
    publicKey: key.publicKey,
    manifestUrl: 'https://downloads.example/manifest.json',
    fetch: fetchImpl,
    canRestart: () => true,
    relaunch: () => undefined,
    onChange: (state) => states.push(state.kind),
    ...extra,
  });
  return { instance, states };
}

describe('manifest signatures', () => {
  it('covers every field', () => {
    const { manifest } = release('1.1.0');
    expect(verifyManifest(manifest, key.publicKey)).toBe(true);
    expect(verifyManifest({ ...manifest, bundleUrl: 'https://evil.example/x.tar.gz' }, key.publicKey)).toBe(false);
    expect(verifyManifest({ ...manifest, signature: undefined as unknown as string }, key.publicKey)).toBe(false);
    expect(verifyManifest(manifest, keyPair().publicKey)).toBe(false);
  });
});

describe('Updater', () => {
  it('downloads, verifies, and installs a newer bundle, then says it’s ready', async () => {
    const { manifest, archive } = release('1.1.0');
    const { instance, states } = updater(server(manifest, archive));
    await instance.check();
    expect(instance.state).toMatchObject({ kind: 'ready', version: '1.1.0', notes: 'What’s new in 1.1.0' });
    expect(states).toContain('downloading');
    expect(verifyBundle(join(bundlesDir, '1.1.0'), key.publicKey).ok).toBe(true);
  });

  it('stays idle when there’s nothing newer', async () => {
    const { manifest } = release('1.0.0');
    const { instance } = updater(server(manifest));
    await instance.check();
    expect(instance.state.kind).toBe('idle');
  });

  it('rejects an unsigned or wrongly signed manifest', async () => {
    const { manifest, archive } = release('1.1.0');
    const forged = signed({ ...manifest, signature: undefined } as unknown as UpdateManifest, keyPair().privateKey);
    const { instance } = updater(server(forged, archive));
    await instance.check();
    expect(instance.state).toMatchObject({ kind: 'error', message: expect.stringContaining('isn’t signed') });
  });

  it('rejects a damaged download and installs nothing', async () => {
    const { manifest, archive } = release('1.1.0', { tamper: true });
    const { instance } = updater(server(manifest, archive));
    await instance.check();
    expect(instance.state).toMatchObject({ kind: 'error', message: expect.stringContaining('damaged') });
    expect(() => readFileSync(join(bundlesDir, '1.1.0', 'bundle.json'))).toThrow();
  });

  it('asks for a new DMG instead of downloading a bundle that needs a newer shell', async () => {
    const { manifest, archive } = release('2.0.0', { shellMin: 2 });
    const fetchImpl = server(manifest, archive);
    const { instance } = updater(fetchImpl);
    await instance.check();
    expect(instance.state).toMatchObject({ kind: 'needsReinstall', version: '2.0.0', downloadUrl: 'https://downloads.example/GigaCAD.dmg' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports an unreachable server as an error', async () => {
    const { instance } = updater((async () => new Response('', { status: 503 })) as unknown as typeof fetch);
    await instance.check();
    expect(instance.state).toMatchObject({ kind: 'error', message: expect.stringContaining('503') });
  });

  it('waits for sync to go idle before restarting', async () => {
    const { manifest, archive } = release('1.1.0');
    let busy = true;
    const relaunch = vi.fn();
    const { instance } = updater(server(manifest, archive), { canRestart: () => !busy, relaunch });
    await instance.check();
    const restarting = instance.restart(5);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(instance.state).toMatchObject({ kind: 'ready', restarting: true });
    expect(relaunch).not.toHaveBeenCalled();
    busy = false;
    await restarting;
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});

describe('per-platform', () => {
  it('reads the Windows manifest on Windows and the original one elsewhere', () => {
    expect(defaultManifestUrl('darwin')).toBe('https://downloads.gigacad.site/desktop/stable/manifest.json');
    expect(defaultManifestUrl('win32')).toBe('https://downloads.gigacad.site/desktop/stable/win32/manifest.json');
  });

  it('uses the tar that ships with each system', () => {
    expect(tarPath('darwin')).toBe('/usr/bin/tar');
    expect(tarPath('win32', { SystemRoot: 'D:\\Windows' })).toBe('D:\\Windows\\System32\\tar.exe');
    expect(tarPath('win32', {})).toBe('C:\\Windows\\System32\\tar.exe');
  });
});
