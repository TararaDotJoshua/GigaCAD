import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './return-path';

describe('auth return path', () => {
  it('keeps the device code through sign-in without accepting another origin', () => {
    expect(safeReturnPath('/device?code=ABCD-2345')).toBe('/device?code=ABCD-2345');
    for (const unsafe of ['https://example.com', '//example.com', '/\\example.com', '/app\nLocation: https://example.com']) {
      expect(safeReturnPath(unsafe)).toBe('/app');
    }
  });

  it('rejects dot segments that resolve to another host', () => {
    for (const unsafe of ['/.//evil.example', '/..//evil.example', '/x/..//evil.example', '/%2e//evil.example', '/x/%2E%2E//evil.example']) {
      expect(safeReturnPath(unsafe)).toBe('/app');
    }
  });

  it('returns the normalized path with its query and hash', () => {
    expect(safeReturnPath('/a/./b/../c?x=1#top')).toBe('/a/c?x=1#top');
    expect(safeReturnPath('/@alice/bracket')).toBe('/@alice/bracket');
    expect(safeReturnPath(null, '/')).toBe('/');
  });
});
