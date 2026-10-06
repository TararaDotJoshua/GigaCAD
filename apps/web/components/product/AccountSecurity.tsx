'use client';

import { useState, type FormEvent } from 'react';
import { authMessage } from '../../lib/auth-messages';
import { createClient } from '../../lib/supabase/client';

type Status = { error?: string; message?: string };

function Status({ status }: { status: Status }) {
  if (status.error) return <span className="form-status is-error" role="alert">{status.error}</span>;
  if (status.message) return <span className="form-status" role="status">{status.message}</span>;
  return null;
}

/**
 * Changes the sign-in email. Supabase emails both the current and the new address, and
 * the change happens once both have confirmed.
 */
export function EmailForm({ current }: { current: string | null }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    if (email.toLowerCase() === current?.toLowerCase()) return setStatus({ error: 'That’s already your email.' });
    setBusy(true);
    setStatus({});
    const redirect = new URL('/settings', window.location.origin);
    redirect.searchParams.set('email', 'confirmed');
    const { error } = await createClient().auth.updateUser({ email }, { emailRedirectTo: redirect.toString() });
    setBusy(false);
    setStatus(error ? { error: authMessage(error) } : { message: `Check both inboxes. Confirm the link sent to ${current ?? 'your current address'} and the one sent to ${email}.` });
  }

  return (
    <form className="form" onSubmit={submit}>
      <label className="field">
        <span>Email address</span>
        <input name="email" type="email" autoComplete="email" defaultValue={current ?? ''} required />
        <small className="field-hint">You log in with it, and GigaCAD sends notices to it.</small>
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy ? 'Sending…' : 'Change email'}
        </button>
        <Status status={status} />
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get('password') ?? '');
    if (password !== data.get('confirm')) return setStatus({ error: 'The passwords don’t match.' });
    setBusy(true);
    setStatus({});
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setStatus({ error: authMessage(error) });
    form.reset();
    setStatus({ message: 'Password changed.' });
  }

  return (
    <form className="form" onSubmit={submit}>
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
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
        <Status status={status} />
      </div>
    </form>
  );
}
