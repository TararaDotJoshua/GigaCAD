import { describe, expect, it } from 'vitest';
import { decodeSegments, folderFromUrl, freeSlug, treePath } from './paths';

describe('free project address', () => {
  it('keeps a free address and numbers a taken one', () => {
    expect(freeSlug('rc-buggy', ['gearbox'])).toBe('rc-buggy');
    expect(freeSlug('rc-buggy', ['rc-buggy'])).toBe('rc-buggy-2');
    expect(freeSlug('rc-buggy', ['rc-buggy', 'rc-buggy-2', 'rc-buggy-3'])).toBe('rc-buggy-4');
  });

  it('stays within 100 characters', () => {
    const long = 'a'.repeat(100);
    expect(freeSlug(long, [long])).toBe(`${'a'.repeat(98)}-2`);
  });
});

describe('folder addresses', () => {
  it('round-trips folder names with literal percent signs and slashes-as-text', () => {
    for (const name of ['a%2Fb', '100%25 done', 'Level 2 folder', '50% off']) {
      const url = treePath('alex', 'robot', `Designs/${name}`);
      expect(folderFromUrl(url)).toBe(`Designs/${name}`);
      expect(decodeSegments(url.split('/').slice(4))).toBe(`Designs/${name}`);
    }
  });

  it('reads only tree addresses', () => {
    expect(folderFromUrl('/alex/robot/tree/Docs?sort=size')).toBe('Docs');
    expect(folderFromUrl('/alex/robot')).toBeNull();
    expect(folderFromUrl('/alex/robot/releases/2')).toBeNull();
  });
});
