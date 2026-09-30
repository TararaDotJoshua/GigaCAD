import { describe, expect, it } from 'vitest';
import { applyIcons } from '../src/main/icons.js';
import { isAppFile } from '../src/main/sync.js';

describe('isAppFile', () => {
  it("skips giga's state and downloads with either separator", () => {
    expect(isAppFile('/Users/a/GigaCAD/a/arm/Branches/dev/.giga/workspace.json')).toBe(true);
    expect(isAppFile('C:\\Users\\a\\GigaCAD\\a\\arm\\Branches\\dev\\.giga\\workspace.json')).toBe(true);
    expect(isAppFile('C:\\Users\\a\\GigaCAD\\a\\arm\\Branches\\dev\\.giga')).toBe(true);
    expect(isAppFile('C:\\Users\\a\\GigaCAD\\a\\arm\\Releases\\v3.downloading\\Arm.SLDPRT')).toBe(true);
    expect(isAppFile('C:\\Users\\a\\GigaCAD\\a\\arm\\Branches\\dev\\.gigacad-placeholder')).toBe(true);
  });

  it('lets real saves through', () => {
    expect(isAppFile('C:\\Users\\a\\GigaCAD\\a\\arm\\Branches\\dev\\parts\\Arm.SLDPRT')).toBe(false);
    expect(isAppFile('/Users/a/GigaCAD/a/arm/Branches/dev/giga-notes.txt')).toBe(false);
    expect(isAppFile('C:\\Users\\a\\GigaCAD\\a\\arm\\Branches\\dev\\.gigaignore')).toBe(false);
  });
});

describe('applyIcons off macOS', () => {
  it('applies nothing and reports every target, without failing', async () => {
    const result = await applyIcons([{ target: 'C:\\x', key: 'folder-plain' }], '/nowhere', '/nowhere', 'win32');
    expect(result).toEqual({ rendered: 0, applied: 0, failed: ['C:\\x'] });
  });
});
