import { describe, expect, it } from 'vitest';
import { freeSlug } from './paths';

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
