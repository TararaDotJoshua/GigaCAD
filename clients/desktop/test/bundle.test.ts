import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compareVersions, manifestFor, MANIFEST_FILE, SIGNATURE_FILE, signBytes, verifyBundle } from '../src/shared/bundle.js';
import { keyPair, makeBundle } from './helpers.js';
import { chooseBundle, clearRollbackNotice, currentBundleDir, markBad, markHealthy, readState, writeState } from '../src/bootstrap/select.js';

const key = keyPair();
let temp: string;
const setup = () => {
  temp = mkdtempSync(join(tmpdir(), 'gigacad-bundles-'));
  return { bundlesDir: join(temp, 'bundles'), builtInDir: join(temp, 'app-bundle'), shellVersion: 1, publicKey: key.publicKey };
};
afterEach(() => rmSync(temp, { recursive: true, force: true }));

describe('verifyBundle', () => {
  it('accepts a signed bundle', () => {
    const { builtInDir } = setup();
    makeBundle(builtInDir, '1.0.0', key.privateKey);
    expect(verifyBundle(builtInDir, key.publicKey)).toMatchObject({ ok: true, manifest: { version: '1.0.0' } });
  });

  it('rejects a changed file, a missing file, a bad signature, a wrong key, and no signature', () => {
    const { builtInDir } = setup();
    makeBundle(builtInDir, '1.0.0', key.privateKey);
    writeFileSync(join(builtInDir, 'main/index.cjs'), 'evil()');
    expect(verifyBundle(builtInDir, key.publicKey)).toEqual({ ok: false, reason: 'changed main/index.cjs' });

    makeBundle(builtInDir, '1.0.0', key.privateKey);
    rmSync(join(builtInDir, 'cli/giga.js'));
    expect(verifyBundle(builtInDir, key.publicKey)).toEqual({ ok: false, reason: 'missing cli/giga.js' });

    makeBundle(builtInDir, '1.0.0', key.privateKey);
    writeFileSync(join(builtInDir, SIGNATURE_FILE), Buffer.alloc(64).toString('base64'));
    expect(verifyBundle(builtInDir, key.publicKey)).toEqual({ ok: false, reason: 'bad signature' });

    makeBundle(builtInDir, '1.0.0', keyPair().privateKey);
    expect(verifyBundle(builtInDir, key.publicKey)).toEqual({ ok: false, reason: 'bad signature' });

    rmSync(join(builtInDir, SIGNATURE_FILE));
    expect(verifyBundle(builtInDir, key.publicKey)).toEqual({ ok: false, reason: 'unsigned' });
  });

  it('rejects a manifest that points outside the bundle', () => {
    const { builtInDir } = setup();
    makeBundle(builtInDir, '1.0.0', key.privateKey);
    const bytes = JSON.stringify({ ...manifestFor(builtInDir, '1.0.0', 1), files: { ...manifestFor(builtInDir, '1.0.0', 1).files, '../x': 'aa' } });
    writeFileSync(join(builtInDir, MANIFEST_FILE), bytes);
    writeFileSync(join(builtInDir, SIGNATURE_FILE), signBytes(bytes, key.privateKey));
    expect(verifyBundle(builtInDir, key.publicKey)).toEqual({ ok: false, reason: 'unsafe path ../x' });
  });
});

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
  });
});

describe('chooseBundle', () => {
  it('falls back to the built-in bundle when nothing newer is downloaded', () => {
    const options = setup();
    makeBundle(options.builtInDir, '1.0.0', key.privateKey);
    expect(chooseBundle(options)).toMatchObject({ source: 'builtin', version: '1.0.0' });
  });

  it('picks the newest valid download and marks it pending', () => {
    const options = setup();
    makeBundle(options.builtInDir, '1.0.0', key.privateKey);
    makeBundle(join(options.bundlesDir, '1.1.0'), '1.1.0', key.privateKey);
    makeBundle(join(options.bundlesDir, '1.2.0'), '1.2.0', key.privateKey);
    expect(chooseBundle(options)).toMatchObject({ source: 'downloaded', version: '1.2.0' });
    expect(readState(options.bundlesDir).pending).toBe('1.2.0');
  });

  it('skips bad bundles, tampered ones, and ones that need a newer shell', () => {
    const options = setup();
    makeBundle(options.builtInDir, '1.0.0', key.privateKey);
    makeBundle(join(options.bundlesDir, '1.1.0'), '1.1.0', key.privateKey);
    makeBundle(join(options.bundlesDir, '1.2.0'), '1.2.0', key.privateKey, 2);
    makeBundle(join(options.bundlesDir, '1.3.0'), '1.3.0', key.privateKey);
    writeFileSync(join(options.bundlesDir, '1.3.0', 'main/index.cjs'), 'tampered');
    makeBundle(join(options.bundlesDir, '1.4.0'), '1.4.0', key.privateKey);
    writeState(options.bundlesDir, { bad: ['1.4.0'] });
    expect(chooseBundle(options)).toMatchObject({ version: '1.1.0' });
    expect(readState(options.bundlesDir).bad).toEqual(['1.4.0', '1.3.0']);
  });

  it('rejects a folder whose signed version doesn’t match its name', () => {
    const options = setup();
    makeBundle(options.builtInDir, '1.0.0', key.privateKey);
    makeBundle(join(options.bundlesDir, '9.0.0'), '1.5.0', key.privateKey);
    expect(chooseBundle(options)).toMatchObject({ source: 'builtin' });
  });

  it('rolls back when a pending bundle never proved healthy, and remembers why', () => {
    const options = setup();
    makeBundle(options.builtInDir, '1.0.0', key.privateKey);
    makeBundle(join(options.bundlesDir, '1.1.0'), '1.1.0', key.privateKey);
    chooseBundle(options);
    markHealthy(options.bundlesDir, '1.1.0');
    makeBundle(join(options.bundlesDir, '1.2.0'), '1.2.0', key.privateKey);
    expect(chooseBundle(options)).toMatchObject({ version: '1.2.0' });
    // The app crashed before markHealthy: the next launch goes back.
    expect(chooseBundle(options)).toMatchObject({ version: '1.1.0', rolledBackFrom: '1.2.0' });
    expect(readState(options.bundlesDir)).toMatchObject({ current: '1.1.0', bad: ['1.2.0'] });
    clearRollbackNotice(options.bundlesDir);
    expect(chooseBundle(options)).toMatchObject({ version: '1.1.0', rolledBackFrom: undefined });
  });

  it('goes back past a healthy bundle that later fails to start', () => {
    const options = setup();
    makeBundle(options.builtInDir, '1.0.0', key.privateKey);
    makeBundle(join(options.bundlesDir, '1.1.0'), '1.1.0', key.privateKey);
    chooseBundle(options);
    markHealthy(options.bundlesDir, '1.1.0');
    markBad(options.bundlesDir, '1.1.0');
    expect(chooseBundle(options)).toMatchObject({ source: 'builtin', rolledBackFrom: '1.1.0' });
  });

  it('returns nothing when even the built-in bundle fails', () => {
    const options = setup();
    makeBundle(options.builtInDir, '1.0.0', keyPair().privateKey);
    expect(chooseBundle(options)).toBeUndefined();
  });
});

describe('markHealthy', () => {
  it('keeps current, previous, and a newer waiting update; deletes the rest', () => {
    const options = setup();
    for (const version of ['1.0.0', '1.1.0', '1.2.0', '1.3.0']) makeBundle(join(options.bundlesDir, version), version, key.privateKey);
    writeState(options.bundlesDir, { current: '1.1.0', previous: '1.0.0', bad: [] });
    markHealthy(options.bundlesDir, '1.2.0');
    expect(readState(options.bundlesDir)).toMatchObject({ current: '1.2.0', previous: '1.1.0' });
    expect(chooseBundle({ ...options, builtInDir: join(temp, 'none') })).toMatchObject({ version: '1.3.0' });
    expect(() => verifyBundle(join(options.bundlesDir, '1.0.0'), key.publicKey)).not.toThrow();
    expect(verifyBundle(join(options.bundlesDir, '1.0.0'), key.publicKey).ok).toBe(false);
  });
});

describe('currentBundleDir (the terminal giga)', () => {
  it('uses the current healthy bundle, else the built-in one, and never changes state', () => {
    const options = setup();
    makeBundle(options.builtInDir, '1.0.0', key.privateKey);
    expect(currentBundleDir(options)).toBe(options.builtInDir);
    makeBundle(join(options.bundlesDir, '1.1.0'), '1.1.0', key.privateKey);
    writeState(options.bundlesDir, { pending: '1.1.0', bad: [] });
    expect(currentBundleDir(options)).toBe(options.builtInDir);
    writeState(options.bundlesDir, { current: '1.1.0', bad: [] });
    expect(currentBundleDir(options)).toBe(join(options.bundlesDir, '1.1.0'));
    expect(readState(options.bundlesDir)).toEqual({ current: '1.1.0', bad: [] });
  });
});
