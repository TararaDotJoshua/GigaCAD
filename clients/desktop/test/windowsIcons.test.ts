import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ICO_SIZES, pngToIco } from '../src/main/ico.js';
import { applyIcons, desktopIni } from '../src/main/icons.js';

// A 1×1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('pngToIco', () => {
  it('writes a header, one entry per image, then the PNGs', () => {
    const ico = pngToIco(ICO_SIZES.map((size) => ({ size, png: PNG })));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(4);
    const entry = (index: number) => ico.subarray(6 + 16 * index, 22 + 16 * index);
    expect([0, 1, 2, 3].map((index) => entry(index).readUInt8(0))).toEqual([16, 32, 48, 0]);
    expect(entry(0).readUInt32LE(8)).toBe(PNG.length);
    expect(entry(0).readUInt32LE(12)).toBe(6 + 16 * 4);
    expect(entry(3).readUInt32LE(12)).toBe(6 + 16 * 4 + 3 * PNG.length);
    expect(ico.subarray(entry(3).readUInt32LE(12)).equals(PNG)).toBe(true);
  });

  it('refuses anything but PNG data', () => {
    expect(() => pngToIco([])).toThrow();
    expect(() => pngToIco([{ size: 16, png: Buffer.from('GIF89a') }])).toThrow(/PNG/);
  });
});

describe('desktopIni', () => {
  it('is UTF-16 with a BOM and points at the icon', () => {
    const ini = desktopIni('C:\\Users\\zoë\\AppData\\Local\\GigaCAD\\icon-cache\\folder-branch.ico');
    expect([...ini.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(ini.subarray(2).toString('utf16le')).toBe('[.ShellClassInfo]\r\nIconResource=C:\\Users\\zoë\\AppData\\Local\\GigaCAD\\icon-cache\\folder-branch.ico,0\r\n');
  });
});

describe.runIf(process.platform === 'win32')('folder icons on Windows', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const attributes = (path: string) => execFileSync('attrib.exe', [path], { encoding: 'utf8' }).slice(0, 20);

  it('writes a hidden system desktop.ini, marks the folder, and can change the icon', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gigacad-icons-'));
    const bundle = join(dir, 'bundle');
    const cache = join(dir, 'cache');
    const folder = join(dir, 'Branches', 'dev');
    mkdirSync(bundle);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(bundle, 'folder-branch.ico'), pngToIco([{ size: 16, png: PNG }]));
    copyFileSync(join(bundle, 'folder-branch.ico'), join(bundle, 'folder-branch-yours.ico'));
    writeFileSync(join(folder, 'Arm.SLDPRT'), 'arm');

    const first = await applyIcons([{ target: folder, key: 'folder-branch' }, { target: join(folder, 'Arm.SLDPRT'), key: 'file-part-sldprt' }], bundle, cache);
    expect(first).toEqual({ rendered: 0, applied: 2, failed: [] });
    const ini = join(folder, 'desktop.ini');
    expect(readFileSync(ini).subarray(2).toString('utf16le')).toContain(join(cache, 'folder-branch.ico'));
    expect(attributes(ini)).toMatch(/S.*H/);
    expect(attributes(folder)).toContain('R');

    await applyIcons([{ target: folder, key: 'folder-branch-yours' }], bundle, cache);
    expect(readFileSync(ini).subarray(2).toString('utf16le')).toContain('folder-branch-yours.ico');

    expect((await applyIcons([{ target: folder, key: 'folder-unknown' }], bundle, cache)).failed).toEqual([folder]);
    execFileSync('attrib.exe', ['-h', '-s', ini]);
  });
});
