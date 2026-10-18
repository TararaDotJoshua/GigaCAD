'use client';

import { useState, type FormEvent } from 'react';
import { authMessage, isSessionMissing } from '../../lib/auth-messages';
import { commonPasswordProblem } from '../../lib/passwords';
import { createClient } from '../../lib/supabase/client';
import { useHydrated } from '../../lib/use-hydrated';
import { LogInAgain } from './ActionButton';

type Status = { error?: string; message?: string; signedOut?: boolean };

function Status({ status }: { status: Status }) {
  if (status.error) {
    return (
      <span className="form-status is-error" role="alert">
        {status.error}
        {status.signedOut && (
          <>
            {' '}
            <LogInAgain />
          </>
        )}
      </span>
    );
  }
  if (status.message) return <span className="form-status" role="status">{status.message}</span>;
  return null;
}

/** An Auth refusal, worded for the Account page: no links to expire here, and you're already signed in. */
function failure(error: unknown, what: string): Status {
  if (isSessionMissing(error)) return { error: `You’ve been signed out. Log in again to change your ${what}.`, signedOut: true };
  return { error: authMessage(error, undefined, { email_exists: 'Another account already uses that email. Choose a different one.' }) };
}

/**
 * Changes the sign-in email. Supabase emails both the current and the new address, and
 * the change happens once both have confirmed. `pending` is a change still waiting for that.
 */
export function EmailForm({ current, pending: pendingAtLoad }: { current: string | null; pending: string | null }) {
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({});
  const [pending, setPending] = useState(pendingAtLoad);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    if (email.toLowerCase() === current?.toLowerCase()) return setStatus({ error: 'That’s already your email.' });
    setBusy(true);
    setStatus({});
    const redirect = new URL('/settings', window.location.origin);
    redirect.searchParams.set('email', 'confirmed');
    const { data, error } = await createClient().auth.updateUser({ email }, { emailRedirectTo: redirect.toString() });
    setBusy(false);
    if (error) return setStatus(failure(error, 'email'));
    // No change pending afterwards means the address was already this account's, perhaps changed in another browser.
    if (!data.user.new_email) return setStatus({ error: 'That’s already your email.' });
    setPending(data.user.new_email);
    setStatus({ message: `Check both inboxes. Confirm the link sent to ${current ?? 'your current address'} and the one sent to ${email}.` });
  }

  async function resend() {
    if (!pending) return;
    // Auth finds the account by its current address, then resends to both.
    if (!current) return setStatus({ error: 'You’ve been signed out. Log in again to resend the links.', signedOut: true });
    setBusy(true);
    setStatus({});
    const { error } = await createClient().auth.resend({ type: 'email_change', email: current });
    setBusy(false);
    setStatus(error ? failure(error, 'email') : { message: `Sent again to ${current} and ${pending}.` });
  }

  return (
    <form className="form" method="post" onSubmit={submit}>
      {pending && (
        <p className="notice" role="status">
          Waiting for confirmation: changing to <strong>{pending}</strong>. Confirm the links sent to both addresses.{' '}
          <button type="button" className="link-button" onClick={resend} disabled={busy || !hydrated}>
            Send the links again
          </button>
          . To change to a different address instead, enter it below.
        </p>
      )}
      <label className="field">
        <span>Email address</span>
        <input name="email" type="email" autoComplete="email" defaultValue={current ?? ''} required />
        <small className="field-hint">You log in with it, and GigaCAD sends notices to it.</small>
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-secondary" disabled={busy || !hydrated}>
          {busy ? 'Sending…' : 'Change email'}
        </button>
        <Status status={status} />
      </div>
    </form>
  );
}

/** Changing the password asks for the current one, so a browser left signed in isn't enough to take the account. */
export function PasswordForm({ email }: { email: string | null }) {
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const current = String(data.get('current') ?? '');
    const password = String(data.get('password') ?? '');
    if (password !== data.get('confirm')) return setStatus({ error: 'The passwords don’t match.' });
    const common = commonPasswordProblem(password);
    if (common) return setStatus({ error: common });
    if (!email) return setStatus({ error: 'You’ve been signed out. Log in again to change your password.', signedOut: true });
    setBusy(true);
    setStatus({});
    const supabase = createClient();
    const check = await supabase.auth.signInWithPassword({ email, password: current });
    if (check.error) {
      setBusy(false);
      return setStatus({ error: check.error.code === 'invalid_credentials' ? 'Your current password is wrong.' : authMessage(check.error) });
    }
    // Supabase checks the current password itself where "Require current password" is on (hosted).
    const { error } = await supabase.auth.updateUser({ password, current_password: current });
    setBusy(false);
    if (error) return setStatus(error.code === 'reauthentication_needed' ? { error: 'For your security, log out and log in again, then change your password.' } : failure(error, 'password'));
    form.reset();
    setStatus({ message: 'Password changed.' });
  }

  // Posted, and disabled until hydrated, so an early Enter never puts passwords in the address bar.
  return (
    <form className="form" method="post" onSubmit={submit}>
      <label className="field">
        <span>Current password</span>
        <input name="current" type="password" autoComplete="current-password" required />
        <small className="field-hint">
          Forgot it? <a href="/forgot-password">Reset it by email</a>.
        </small>
      </label>
      <label className="field">
        <span>New password</span>
        <input name="password" type="password" autoComplete="new-password" minLength={8} required />
        <small className="field-hint">At least 8 characters.</small>
      </label>
      <label className="field">
        <span>Confirm new password</span>
        <input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-secondary" disabled={busy || !hydrated}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
        <Status status={status} />
      </div>
    </form>
  );
}
