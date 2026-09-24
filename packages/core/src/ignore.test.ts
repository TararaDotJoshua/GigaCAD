import { describe, expect, it } from 'vitest';
import { createIgnoreMatcher } from './ignore.js';

describe('createIgnoreMatcher', () => {
  const isIgnored = createIgnoreMatcher();

  it.each([
    '~$Arm.SLDPRT',
    'parts/~$Base.sldprt',
    'Backup of Robot.SLDASM',
    'Backup (2) of Robot.SLDASM',
    'AutoRecover of Arm.SLDPRT',
    'scratch.TMP',
    'model.FCBak',
    'docs/.~lock.notes.odt#',
    'Thumbs.db',
    'sub/.DS_Store',
  ])('ignores %s', (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  it.each(['Arm.SLDPRT', 'Robot.SLDASM', 'drawings/Arm.SLDDRW', 'exports/Arm.STEP', '.gigaignore'])(
    'keeps %s',
    (path) => {
      expect(isIgnored(path)).toBe(false);
    },
  );

  it('applies project .gigaignore rules on top of the defaults', () => {
    const matcher = createIgnoreMatcher('renders/\n*.log\n!keep.log\n');

    expect(matcher('renders/hero.png')).toBe(true);
    expect(matcher('build.LOG')).toBe(true);
    expect(matcher('keep.log')).toBe(false);
    expect(matcher('~$Arm.SLDPRT')).toBe(true);
  });

  it('accepts Windows-style paths', () => {
    expect(createIgnoreMatcher('renders/')('renders\\hero.png')).toBe(true);
  });
});
