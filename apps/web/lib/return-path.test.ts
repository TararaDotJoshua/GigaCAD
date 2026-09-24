import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './return-path';

describe('auth return path', () => {
  it('keeps the device code through sign-in without accepting another origin', () => {
    expect(safeReturnPath('/device?code=ABCD-2345')).toBe('/device?code=ABCD-2345');
    for (const unsafe of ['https://example.com', '//example.com', '/\\example.com', '/app\nLocation: https://example.com']) {
      expect(safeReturnPath(unsafe)).toBe('/app');
    }
  });
});
