import { describe, expect, it } from 'vitest';
import { HANDLE_PATTERN, isPlaceholderHandle, isReservedHandle } from './handles.js';

describe('handles', () => {
  it('accepts ordinary handles and rejects badly formed ones', () => {
    for (const handle of ['alex', 'sam-3d', 'a', 'x'.repeat(39)]) expect(HANDLE_PATTERN.test(handle)).toBe(true);
    for (const handle of ['-alex', 'alex-', 'Alex', 'al_ex', 'x'.repeat(40), '']) expect(HANDLE_PATTERN.test(handle)).toBe(false);
  });

  it('reserves the names of top-level pages', () => {
    for (const handle of ['login', 'settings', 'docs', 'new', 'device', 'Settings']) expect(isReservedHandle(handle)).toBe(true);
    expect(isReservedHandle('alex')).toBe(false);
  });

  it('recognizes only the exact placeholder new accounts get', () => {
    expect(isPlaceholderHandle('user-0a1b2c3d4e5f')).toBe(true);
    for (const handle of ['user-bob', 'user-0a1b2c3d4e5', 'user-0a1b2c3d4e5f6', 'alex']) expect(isPlaceholderHandle(handle)).toBe(false);
  });
});
