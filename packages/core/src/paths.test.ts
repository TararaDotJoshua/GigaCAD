import { describe, expect, it } from 'vitest';
import { branchNameProblem, InvalidPathError, isReservedRootName, validateEntryName, validateProjectPath } from './paths.js';

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

describe('branchNameProblem', () => {
  it('accepts the names the API accepts', () => {
    for (const name of ['gripper-v2', 'v3', 'battery_tray.rev-b', 'a']) expect(branchNameProblem(name)).toBeNull();
  });

  it('says what to change', () => {
    expect(branchNameProblem('')).toBe('Give the branch a name.');
    expect(branchNameProblem('wheel hub')).toBe('Use letters, digits, dots, dashes, or underscores.');
    expect(branchNameProblem('-draft')).toBe('Start and end with a letter or digit.');
    expect(branchNameProblem('x'.repeat(101))).toBe('Use 100 characters or fewer.');
  });
});

describe('validateProjectPath', () => {
  it('normalizes ordinary paths', () => {
    expect(validateProjectPath('./parts//Bracket rev B.SLDPRT')).toBe('parts/Bracket rev B.SLDPRT');
    expect(validateProjectPath('Releases/notes.txt')).toBe('Releases/notes.txt');
  });

  it.each([
    'parts/stream.txt:hidden.exe',
    'parts/CON.SLDPRT',
    'parts/trailing. ',
    'parts/dir./a.txt',
    'a<b>|c?.SLDPRT',
    'parts/\u202Etxt.exe',
    'parts/a\u2066b.txt',
    'a\u0000b.txt',
    `${'a/'.repeat(600)}x`,
  ])('refuses %j, which Windows can’t store or which reads as something else', (path) => {
    expect(() => validateProjectPath(path)).toThrow(InvalidPathError);
  });
});

