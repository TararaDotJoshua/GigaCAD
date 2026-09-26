import { describe, expect, it } from 'vitest';
import { InvalidPathError, isReservedRootName, validateEntryName } from './paths.js';

describe('validateEntryName', () => {
  it('accepts ordinary file and folder names', () => {
    expect(validateEntryName('Bracket rev B.SLDPRT')).toBe('Bracket rev B.SLDPRT');
    expect(validateEntryName('Branches', { atRoot: false })).toBe('Branches');
    expect(validateEntryName('.gitignore')).toBe('.gitignore');
  });

  it.each(['', '.', '..', 'a/b', 'a\\b', 'what?', 'x:y', 'trailing.', 'trailing ', ' leading', 'CON', 'nul.txt', 'com1', 'a'.repeat(256), 'tab\there'])(
    'rejects %j',
    (name) => {
      expect(() => validateEntryName(name)).toThrow(InvalidPathError);
    },
  );

  it('reserves Branches and Releases at the project root, ignoring case', () => {
    expect(() => validateEntryName('branches', { atRoot: true })).toThrow(/reserved/);
    expect(() => validateEntryName('RELEASES', { atRoot: true })).toThrow(/reserved/);
    expect(isReservedRootName('Releases')).toBe(true);
    expect(isReservedRootName('Releases v2')).toBe(false);
  });
});
