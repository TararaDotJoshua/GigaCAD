import { describe, expect, it } from 'vitest';
import { diffManifests, validateManifest, type ManifestEntry } from './manifest.js';
import { InvalidPathError, normalizePath, pathKey } from './paths.js';

const entry = (itemId: string, path: string, blob: string): ManifestEntry => ({ itemId, path, blob });

describe('normalizePath', () => {
  it('normalizes Windows separators and redundant prefixes', () => {
    expect(normalizePath('.\\parts\\\\Arm.SLDPRT')).toBe('parts/Arm.SLDPRT');
  });

  it.each(['', '/abs/Arm.SLDPRT', 'C:\\Robot\\Arm.SLDPRT', '\\\\server\\share\\a.sldprt', 'parts/', 'parts/../x.sldprt'])(
    'rejects %j',
    (input) => {
      expect(() => normalizePath(input)).toThrow(InvalidPathError);
    },
  );

  it('compares paths case-insensitively', () => {
    expect(pathKey('Parts\\ARM.sldprt')).toBe(pathKey('parts/Arm.SLDPRT'));
  });
});

describe('validateManifest', () => {
  it('reports duplicate items, case-insensitive path collisions, and unnormalized paths', () => {
    const issues = validateManifest([
      entry('a', 'Arm.SLDPRT', '1'),
      entry('b', 'arm.sldprt', '2'),
      entry('a', 'Other.SLDPRT', '3'),
      entry('c', 'parts\\Base.SLDPRT', '4'),
    ]);

    expect(issues).toEqual([
      { kind: 'duplicate_item', itemId: 'a' },
      { kind: 'invalid_path', itemId: 'c', path: 'parts\\Base.SLDPRT', reason: 'path is not normalized' },
      { kind: 'duplicate_path', path: 'Arm.SLDPRT', itemIds: ['a', 'b'] },
    ]);
  });
});

describe('diffManifests', () => {
  it('reports additions, deletions, edits, and renames by item', () => {
    const before = [entry('a', 'A.SLDPRT', '1'), entry('b', 'B.SLDPRT', '1'), entry('c', 'C.SLDPRT', '1')];
    const after = [entry('a', 'A.SLDPRT', '2'), entry('c', 'sub/C.SLDPRT', '1'), entry('d', 'D.SLDPRT', '1')];

    expect(diffManifests(before, after)).toEqual([
      { kind: 'modified', itemId: 'a', before: before[0], after: after[0], contentChanged: true, moved: false },
      { kind: 'deleted', itemId: 'b', before: before[1] },
      { kind: 'added', itemId: 'd', after: after[2] },
      { kind: 'modified', itemId: 'c', before: before[2], after: after[1], contentChanged: false, moved: true },
    ]);
  });

  it('returns nothing for identical manifests', () => {
    const manifest = [entry('a', 'A.SLDPRT', '1')];
    expect(diffManifests(manifest, [...manifest])).toEqual([]);
  });
});
