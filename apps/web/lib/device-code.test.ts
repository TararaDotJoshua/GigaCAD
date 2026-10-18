import { describe, expect, it } from 'vitest';
import { normalizeCode } from './device-code';

describe('sign-in codes', () => {
  it('reads a code however it was typed or pasted', () => {
    for (const typed of ['abcd-2345', 'ABCD2345', ' ABCD-2345', 'abcd 2345', 'AB CD-23 45 ']) expect(normalizeCode(typed)).toBe('ABCD-2345');
  });

  it('adds the dash only once there is something after it', () => {
    expect(normalizeCode('abcd')).toBe('ABCD');
    expect(normalizeCode('abcd2')).toBe('ABCD-2');
    expect(normalizeCode('ABCD-23456789')).toBe('ABCD-2345');
  });
});
