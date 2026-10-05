import { describe, expect, it } from 'vitest';
import { authMessage } from './auth-messages';

describe('auth error messages', () => {
  it('rewords known Supabase errors and keeps unknown ones', () => {
    expect(authMessage(Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' }))).toBe('That email and password don’t match an account.');
    expect(authMessage(new Error('Auth session missing!'))).toBe('This link has expired. Request a new one.');
    expect(authMessage(new Error('Something specific'))).toBe('Something specific');
    expect(authMessage('not an error')).toBe('Something went wrong. Try again.');
  });
});
