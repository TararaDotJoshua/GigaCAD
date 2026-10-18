import { describe, expect, it } from 'vitest';
import { characterCount, limitEdit } from './text-limit';

describe('limited text fields', () => {
  it('lets edits through while they fit', () => {
    expect(limitEdit('abc', 'abcd', 5)).toEqual({ value: 'abcd', caret: null });
  });

  it('cuts only what was typed or pasted, wherever it went', () => {
    // Typing in the middle of a full field changes nothing, and the caret stays put.
    expect(limitEdit('abcde', 'abXcde', 5)).toEqual({ value: 'abcde', caret: 2 });
    // A paste in the middle keeps what fits and the original end.
    expect(limitEdit('ab-de', 'ab123456-de', 8)).toEqual({ value: 'ab123-de', caret: 5 });
    // Replacing a selection frees its room first.
    expect(limitEdit('abcde', 'aXYZWe', 5)).toEqual({ value: 'aXYZe', caret: 4 });
  });

  it('never cuts an emoji in half', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(characterCount(family)).toBe(7);
    expect(limitEdit('abc', `abc${family}`, 8)).toEqual({ value: 'abc', caret: 3 });
    expect(limitEdit('abc', `abc${family}`, 10).value).toBe(`abc${family}`);
  });
});
