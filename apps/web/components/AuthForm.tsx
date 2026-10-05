'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { authMessage, LOGIN_ERRORS } from '../lib/auth-messages';
import { dashboardPath } from '../lib/hosts';
import { createClient } from '../lib/supabase/client';
import { safeReturnPath } from '../lib/return-path';

type Mode = 'login' | 'signup' | 'forgot' | 'reset';

const titles: Record<Mode, string> = {
  login: 'Log in to GigaCAD.',
  signup: 'Create your account.',
  forgot: 'Reset your password.',
  reset: 'Choose a new password.',
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeReturnPath(search.get('next'), dashboardPath());
  const [email, setEmail] = useState(search.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // Sign-up that needs email confirmation swaps the form for an inbox panel.
  const [sentTo, setSentTo] = useState('');
  // A reset page opened without a recovery session (an old or reused link) can't save anything.
  const [expired, setExpired] = useState(false);
  const oauthProviders = [
    process.env.NEXT_PUBLIC_GITHUB_AUTH_ENABLED === 'true' ? 'github' : null,
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true' ? 'google' : null,
  ].filter((provider): provider is 'github' | 'google' => provider !== null);

  useEffect(() => {
    if (mode !== 'reset') return;
    createClient().auth.getSession().then(({ data }) => setExpired(!data.session));
  }, [mode]);

  /** Links between the sign-in pages keep where you were going and the email you typed. */
  const carry = (path: string) => {
    const query = new URLSearchParams();
    if (search.get('next')) query.set('next', next);
    if (email) query.set('email', email);
    const text = query.toString();
    return text ? `${path}?${text}` : path;
  };

  const confirmUrl = () => new URL(next, window.location.origin).toString();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if ((mode === 'signup' || mode === 'reset') && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(next);
        router.refresh();
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: confirmUrl() } });
        if (error) throw error;
        if (data.session) {
          router.push(next);
          router.refresh();
        } else setSentTo(email);
      } else if (mode === 'forgot') {
        const redirect = new URL('/reset-password', window.location.origin);
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirect.toString() });
        if (error) throw error;
        setNotice('If this email has an account, a reset link is on its way. It works once, for an hour.');
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        router.push(dashboardPath());
        router.refresh();
      }
    } catch (cause) {
      setError(authMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const { error } = await createClient().auth.resend({ type: 'signup', email: sentTo, options: { emailRedirectTo: confirmUrl() } });
      if (error) throw error;
      setNotice('Sent again. It can take a minute to arrive.');
    } catch (cause) {
      setError(authMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function oauth(provider: 'github' | 'google') {
    setError('');
    setBusy(true);
    try {
      const redirect = new URL('/auth/callback', window.location.origin);
      redirect.searchParams.set('next', next);
      const { error } = await createClient().auth.signInWithOAuth({ provider, options: { redirectTo: redirect.toString() } });
      if (error) throw error;
    } catch (cause) {
      setError(authMessage(cause, 'Could not start sign-in.'));
      setBusy(false);
    }
  }

  const messages = (
    <>
      {(error || search.has('error')) && (
        <p className="form-message form-error" role="alert">
          {error || LOGIN_ERRORS[search.get('error') ?? ''] || 'That email or sign-in link could not be used. Please try again.'}
        </p>
      )}
      {notice && <p className="form-message form-success" role="status">{notice}</p>}
    </>
  );

  if (sentTo) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Check your inbox.</h1>
          <p className="auth-intro">
            We sent a confirmation link to <strong>{sentTo}</strong>. Open it to finish creating your account. It signs you in, so you can close this tab.
          </p>
          <p className="auth-hint">Not there after a minute? Check your spam folder, or send it again.</p>
          <div className="auth-form">
            {messages}
            <button className="button auth-submit" type="button" onClick={resend} disabled={busy}>{busy ? 'Sending…' : 'Resend email'}</button>
          </div>
          <div className="auth-links">
            <button type="button" className="auth-link-button" onClick={() => { setSentTo(''); setNotice(''); setError(''); }}>Wrong address? Start over</button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'reset' && expired) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>This link has expired.</h1>
          <p className="auth-intro">Password reset links work once, for an hour. Ask for a new one and use the newest email.</p>
          <Link className="button auth-submit" href="/forgot-password">Send a new link</Link>
          <div className="auth-links"><Link href="/login">Back to log in</Link></div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>{titles[mode]}</h1>
        <p className="auth-intro">
          {mode === 'login' && 'Pick up where you left off with your projects and releases.'}
          {mode === 'signup' && 'Start a project, work on branches, and keep every release locked.'}
          {mode === 'forgot' && 'Enter your account email and we’ll send a reset link.'}
          {mode === 'reset' && 'Your new password will be used the next time you log in.'}
        </p>
        <form onSubmit={submit} className="auth-form">
          {mode !== 'reset' && <label>Email<input type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>}
          {mode !== 'forgot' && (
            <div className="auth-field">
              <label>
                {mode === 'reset' ? 'New password' : 'Password'}
                <input type="password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required aria-describedby={mode === 'login' ? undefined : 'password-hint'} />
              </label>
              {mode !== 'login' && <p className="auth-field-hint" id="password-hint">At least 8 characters.</p>}
            </div>
          )}
          {(mode === 'signup' || mode === 'reset') && <label>Confirm password<input type="password" name="confirm" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>}
          {messages}
          <button className="button auth-submit" type="submit" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Save password'}</button>
        </form>
        {(mode === 'login' || mode === 'signup') && oauthProviders.length > 0 && <>
          <div className="auth-divider"><span>or continue with</span></div>
          <div className="auth-social">
            {oauthProviders.map((provider) => <button key={provider} type="button" onClick={() => oauth(provider)} disabled={busy}>{provider === 'github' ? 'GitHub' : 'Google'}</button>)}
          </div>
        </>}
        <div className="auth-links">
          {mode === 'login' && <><Link href={carry('/signup')}>Create an account</Link><Link href={carry('/forgot-password')}>Forgot password?</Link></>}
          {mode === 'signup' && <Link href={carry('/login')}>Already have an account? Log in</Link>}
          {(mode === 'forgot' || mode === 'reset') && <Link href={carry('/login')}>Back to log in</Link>}
        </div>
      </div>
    </div>
  );
}
