import { describe, expect, it } from 'vitest';
import { BRANCH_NAME_HTML_PATTERN, branchNameProblem } from './branches.js';

describe('branch names', () => {
  it('accepts ordinary names', () => {
    for (const name of ['gripper-redesign', 'v2.1', 'a', 'Rear_arm', 'x'.repeat(100)]) expect(branchNameProblem(name)).toBeNull();
  });

  it('says what is wrong with each bad name', () => {
    expect(branchNameProblem('')).toBe('Enter a branch name');
    expect(branchNameProblem('x'.repeat(101))).toBe('Use at most 100 characters');
    expect(branchNameProblem('my branch')).toBe('Use dashes or underscores instead of spaces');
    expect(branchNameProblem('rear/arm')).toBe('Use only letters, digits, dots, dashes, and underscores');
    for (const name of ['-lead', 'lead-', '.hidden', 'trailing.', '_x']) expect(branchNameProblem(name)).toBe('Start and end with a letter or digit');
  });

  it('keeps main for the released line', () => {
    expect(branchNameProblem('main')).toBe('main is the released line. Pick another name');
    expect(branchNameProblem('Main')).toBe('Main is the released line. Pick another name');
    expect(branchNameProblem('main-2')).toBeNull();
  });

  it('has an HTML pattern that compiles with the v flag and agrees with the rule', () => {
    const pattern = new RegExp(`^(?:${BRANCH_NAME_HTML_PATTERN})$`, 'v');
    for (const name of ['gripper-redesign', 'v2.1', 'a', 'my branch', '-lead', 'lead-', '.hidden']) {
      expect(pattern.test(name)).toBe(branchNameProblem(name) === null);
    }
  });
});
