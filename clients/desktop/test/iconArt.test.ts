import { describe, expect, it } from 'vitest';
import { FOLDER_ICONS, fileIconKey, iconPixels, iconSvg, prerenderedKeys } from '../src/main/iconArt.js';

describe('fileIconKey', () => {
  it('uses the web app’s kinds with the extension as a label', () => {
    expect(fileIconKey('Arm.SLDPRT')).toBe('file-part-sldprt');
    expect(fileIconKey('Bench.sldasm')).toBe('file-assembly-sldasm');
    expect(fileIconKey('Base.dxf')).toBe('file-drawing-dxf');
    expect(fileIconKey('notes.md')).toBe('file-file-md');
  });

  it('drops labels it can’t draw well', () => {
    expect(fileIconKey('README')).toBe('file-file-');
    expect(fileIconKey('.env')).toBe('file-file-');
    expect(fileIconKey('archive.verylongext')).toBe('file-file-');
    expect(fileIconKey('odd.a-b')).toBe('file-file-');
  });
});

describe('prerenderedKeys', () => {
  it('covers every folder kind, the plain file, and known extensions', () => {
    const keys = prerenderedKeys();
    for (const folder of Object.keys(FOLDER_ICONS)) expect(keys).toContain(folder);
    expect(keys).toContain('file-file-');
    expect(keys).toContain('file-part-step');
    expect(keys).toContain('file-drawing-pdf');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('draws every one of them, with hex colors CoreSVG understands', () => {
    for (const key of [...prerenderedKeys(), 'app', 'tray']) {
      const svg = iconSvg(key);
      expect(svg).toMatch(/^<svg /);
      expect(svg).not.toMatch(/rgb\(/);
    }
    expect(() => iconSvg('nonsense')).toThrow();
  });

  it('keeps file icons small', () => {
    expect(iconPixels('folder-project')).toBe(512);
    expect(iconPixels('file-part-sldprt')).toBe(256);
  });
});
