import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isLocked, lock, unlock, whileUnlocked } from '../src/main/locks.js';

// Locks use Finder's Locked flag (chflags), which only macOS has.
const macOnly = process.platform === 'darwin' ? describe : describe.skip;

const flags = (path: string) => execFileSync('/bin/ls', ['-ldO', path], { encoding: 'utf8' }).split(/\s+/)[4];
const writable = (path: string) => (lstatSync(path).mode & 0o200) !== 0;

macOnly('locks', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) {
      await unlock(dir).catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tree(): string {
    dir = mkdtempSync(join(tmpdir(), 'gigacad-locks-'));
    mkdirSync(join(dir, 'parts'));
    mkdirSync(join(dir, '.giga'));
    writeFileSync(join(dir, 'parts', 'Arm.SLDPRT'), 'arm');
    writeFileSync(join(dir, 'Bench.SLDASM'), 'bench');
    writeFileSync(join(dir, '.giga', 'workspace.json'), '{}');
    writeFileSync(join(dir, 'Icon\r'), '');
    return dir;
  }

  it('makes files read-only and Locked, and folders unwritable, but leaves .giga and the icon file alone', async () => {
    const root = tree();
    await lock(root);
    expect(await isLocked(root)).toBe(true);
    for (const file of [join(root, 'Bench.SLDASM'), join(root, 'parts', 'Arm.SLDPRT')]) {
      expect(writable(file)).toBe(false);
      expect(flags(file)).toContain('uchg');
    }
    expect(writable(join(root, 'parts'))).toBe(false);
    expect(writable(join(root, '.giga', 'workspace.json'))).toBe(true);
    expect(writable(join(root, '.giga'))).toBe(true);
    expect(writable(join(root, 'Icon\r'))).toBe(true);
  });

  it('unlocks everything it locked, and can lock twice', async () => {
    const root = tree();
    await lock(root);
    await lock(root);
    await unlock(root);
    expect(await isLocked(root)).toBe(false);
    expect(writable(join(root, 'parts', 'Arm.SLDPRT'))).toBe(true);
    expect(flags(join(root, 'parts', 'Arm.SLDPRT'))).not.toContain('uchg');
    writeFileSync(join(root, 'parts', 'New.SLDPRT'), 'new');
  });

  it('locks again after a change, even one that fails, including new files', async () => {
    const root = tree();
    await lock(root);
    await whileUnlocked(root, async () => writeFileSync(join(root, 'parts', 'Pulled.SLDPRT'), 'pulled'));
    expect(flags(join(root, 'parts', 'Pulled.SLDPRT'))).toContain('uchg');
    await expect(whileUnlocked(root, async () => Promise.reject(new Error('pull failed')))).rejects.toThrow('pull failed');
    expect(await isLocked(root)).toBe(true);
  });
});
