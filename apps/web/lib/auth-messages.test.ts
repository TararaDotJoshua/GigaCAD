import { describe, expect, it } from 'vitest';
import { authMessage, isSessionMissing } from './auth-messages';

describe('auth error messages', () => {
  it('rewords known Supabase errors and keeps unknown ones', () => {
    expect(authMessage(Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' }))).toBe('That email and password don’t match an account.');
    expect(authMessage(new Error('Auth session missing!'))).toBe('This link has expired. Request a new one.');
    expect(authMessage(new Error('Something specific'))).toBe('Something specific');
    expect(authMessage('not an error')).toBe('Something went wrong. Try again.');
  });

  it('lets a page word a code its own way', () => {
    const exists = Object.assign(new Error('A user with this email address has already been registered'), { code: 'email_exists' });
    expect(authMessage(exists)).toBe('There’s already an account with that email. Log in instead.');
    expect(authMessage(exists, undefined, { email_exists: 'Another account already uses that email.' })).toBe('Another account already uses that email.');
  });

  it('knows a session that is gone from a link that expired', () => {
    expect(isSessionMissing(new Error('Auth session missing!'))).toBe(true);
    expect(isSessionMissing(Object.assign(new Error('Session from session_id claim in JWT does not exist'), { code: 'session_not_found' }))).toBe(true);
    expect(isSessionMissing(Object.assign(new Error('nope'), { code: 'otp_expired' }))).toBe(false);
  });
});
