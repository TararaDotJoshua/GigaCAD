import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasDenyEntry, isLocked, lock, parseUserSid, unlock, whileUnlocked } from '../src/main/locks.js';

// Each system locks its own way: Finder's Locked flag (chflags) on macOS, the read-only attribute
// and folder deny entries (icacls) on Windows.
const macOnly = process.platform === 'darwin' ? describe : describe.skip;
const windowsOnly = process.platform === 'win32' ? describe : describe.skip;

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

describe('Windows lock helpers', () => {
  it("reads this user's SID from whoami", () => {
    expect(parseUserSid('"desktop-7\\alex","S-1-5-21-1004336348-1177238915-682003330-1001"\r\n')).toBe('S-1-5-21-1004336348-1177238915-682003330-1001');
    expect(() => parseUserSid('nothing here')).toThrow(/SID/);
  });

  it('spots the deny entry a lock adds', () => {
    expect(hasDenyEntry('C:\\x DESKTOP-7\\alex:(DENY)(WD,AD,DC)\r\n   NT AUTHORITY\\SYSTEM:(OI)(CI)(F)\r\n')).toBe(true);
    expect(hasDenyEntry('C:\\x NT AUTHORITY\\SYSTEM:(OI)(CI)(F)\r\n    DESKTOP-7\\alex:(OI)(CI)(F)\r\n')).toBe(false);
  });
});

windowsOnly('locks on Windows', () => {
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
    writeFileSync(join(dir, 'desktop.ini'), '[.ShellClassInfo]');
    return dir;
  }

  it('stops edits, new files, renames, and deletes, but leaves .giga and desktop.ini alone', async () => {
    const root = tree();
    await lock(root);
    expect(await isLocked(root)).toBe(true);
    expect(await isLocked(join(root, 'parts'))).toBe(true);
    expect(writable(join(root, 'parts', 'Arm.SLDPRT'))).toBe(false);
    expect(() => writeFileSync(join(root, 'Bench.SLDASM'), 'changed')).toThrow();
    expect(() => writeFileSync(join(root, 'parts', 'New.SLDPRT'), 'new')).toThrow();
    expect(() => mkdirSync(join(root, 'parts', 'more'))).toThrow();
    expect(() => renameSync(join(root, 'parts', 'Arm.SLDPRT'), join(root, 'parts', 'Renamed.SLDPRT'))).toThrow();
    expect(() => unlinkSync(join(root, 'Bench.SLDASM'))).toThrow();
    writeFileSync(join(root, '.giga', 'workspace.json'), '{"head":"x"}');
    writeFileSync(join(root, '.giga', 'new.json'), '{}');
    writeFileSync(join(root, 'desktop.ini'), '[.ShellClassInfo]\r\nIconResource=x.ico,0');
  });

  it('unlocks everything it locked, and can lock twice', async () => {
    const root = tree();
    await lock(root);
    await lock(root);
    await unlock(root);
    expect(await isLocked(root)).toBe(false);
    expect(await isLocked(join(root, 'parts'))).toBe(false);
    expect(writable(join(root, 'parts', 'Arm.SLDPRT'))).toBe(true);
    writeFileSync(join(root, 'parts', 'New.SLDPRT'), 'new');
    renameSync(join(root, 'parts', 'New.SLDPRT'), join(root, 'parts', 'Renamed.SLDPRT'));
    unlinkSync(join(root, 'parts', 'Renamed.SLDPRT'));
  });

  it('locks again after a change, even one that fails, including new files', async () => {
    const root = tree();
    await lock(root);
    await whileUnlocked(root, async () => writeFileSync(join(root, 'parts', 'Pulled.SLDPRT'), 'pulled'));
    expect(writable(join(root, 'parts', 'Pulled.SLDPRT'))).toBe(false);
    await expect(whileUnlocked(root, async () => Promise.reject(new Error('pull failed')))).rejects.toThrow('pull failed');
    expect(await isLocked(root)).toBe(true);
  });
});

