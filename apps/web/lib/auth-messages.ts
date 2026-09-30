/**
 * Plain sentences for Supabase Auth errors. Supabase's own messages ("Invalid login
 * credentials", "Auth session missing!") read like logs. Unknown errors keep their message.
 */
const BY_CODE: Readonly<Record<string, string>> = {
  invalid_credentials: 'That email and password don’t match an account.',
  email_not_confirmed: 'Confirm your email first. The link is in the email we sent when you signed up.',
  user_already_exists: 'There’s already an account with that email. Log in instead.',
  email_exists: 'There’s already an account with that email. Log in instead.',
  weak_password: 'Choose a longer password: at least 8 characters.',
  same_password: 'That’s your current password. Choose a new one.',
  over_email_send_rate_limit: 'We just sent you an email. Wait a minute before asking for another.',
  over_request_rate_limit: 'Too many attempts. Wait a minute and try again.',
  session_not_found: 'This link has expired. Request a new one.',
  session_expired: 'This link has expired. Request a new one.',
  otp_expired: 'This link has expired. Request a new one.',
  signup_disabled: 'New accounts are closed right now.',
  validation_failed: 'Check the email address and try again.',
};

export function authMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (!(error instanceof Error)) return fallback;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && BY_CODE[code]) return BY_CODE[code];
  if (/auth session missing/i.test(error.message)) return BY_CODE.session_not_found!;
  return error.message || fallback;
}

/** Messages for `?error=` on the log-in page, set by the email-link and OAuth handlers. */
export const LOGIN_ERRORS: Readonly<Record<string, string>> = {
  confirmation: 'That confirmation link has expired or was already used. Log in, or sign up again to get a new link.',
  callback: 'Sign-in with that provider didn’t finish. Try again.',
  recovery: 'That reset link has expired or was already used. Ask for a new one below.',
};
