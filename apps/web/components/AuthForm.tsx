'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { authMessage, LOGIN_ERRORS } from '../lib/auth-messages';
import type { AuthQuery } from '../lib/auth-query';
import { dashboardPath } from '../lib/hosts';
import { commonPasswordProblem } from '../lib/passwords';
import { createClient } from '../lib/supabase/client';
import { safeReturnPath } from '../lib/return-path';

type Mode = 'login' | 'signup' | 'forgot' | 'reset';

const titles: Record<Mode, string> = {
  login: 'Log in to GigaCAD.',
  signup: 'Create your account.',
  forgot: 'Reset your password.',
  reset: 'Choose a new password.',
};

/** Whether the session's sign-in methods include a reset link used in the last hour. */
export function isRecentRecovery(amr: unknown, now = Date.now()): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some(
    (entry: { method?: unknown; timestamp?: unknown }) =>
      (entry?.method === 'recovery' || entry?.method === 'otp') && typeof entry.timestamp === 'number' && now / 1000 - entry.timestamp < 3600,
  );
}

/** The log-in intro says why you're here when you came from somewhere specific. */
function loginIntro(rawNext: string | null, next: string): string {
  if (next.startsWith('/device')) return 'Log in to approve the sign-in from your device. You’ll confirm the code next.';
  if (rawNext && next !== dashboardPath()) return 'Log in to continue.';
  return 'Pick up where you left off with your projects and releases.';
}

export function AuthForm({ mode, query, siteUrl }: { mode: Mode; query: AuthQuery; siteUrl: string }) {
  const router = useRouter();
  const next = safeReturnPath(query.next, dashboardPath());
  const [email, setEmail] = useState(query.email);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // Sign-up that needs email confirmation swaps the form for an inbox panel.
  const [sentTo, setSentTo] = useState('');
  // A reset page opened without a recovery session (an old or reused link) can't save anything.
  // Null until the session has been checked, so the form never flashes before "expired".
  const [expired, setExpired] = useState<boolean | null>(mode === 'reset' ? null : false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const oauthProviders = [
    process.env.NEXT_PUBLIC_GITHUB_AUTH_ENABLED === 'true' ? 'github' : null,
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true' ? 'google' : null,
  ].filter((provider): provider is 'github' | 'google' => provider !== null);

  useEffect(() => {
    if (mode !== 'reset') return;
    // Only a session that came from a reset link may set a password here, within the link's hour.
    // An ordinary signed-in session changes it in Account settings, with the current password.
    createClient()
      .auth.getClaims()
      .then(({ data }) => setExpired(!isRecentRecovery(data?.claims?.amr)));
  }, [mode]);

  // Confirming in another tab signs this browser in; move on instead of waiting on "Check your inbox".
  useEffect(() => {
    if (!sentTo) return;
    const supabase = createClient();
    const go = () => {
      router.replace(next);
      router.refresh();
    };
    const check = () => void supabase.auth.getSession().then(({ data }) => data.session && go());
    const { data } = supabase.auth.onAuthStateChange((event, session) => event === 'SIGNED_IN' && session && go());
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [sentTo, next, router]);

  /** Links between the sign-in pages keep where you were going and the email you typed. */
  const carry = (path: string) => {
    const params = new URLSearchParams();
    if (query.next) params.set('next', next);
    if (email) params.set('email', email);
    const text = params.toString();
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
    const common = mode === 'signup' || mode === 'reset' ? commonPasswordProblem(password) : null;
    if (common) {
      setError(common);
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
        setNotice('If this email has an account, a reset link is on its way. Only the newest email’s link works, once, for an hour.');
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPasswordSaved(true);
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
      const supabase = createClient();
      // Already confirmed (in another tab, say): nothing to resend, so go on.
      if ((await supabase.auth.getSession()).data.session) {
        router.replace(next);
        router.refresh();
        return;
      }
      const { error } = await supabase.auth.resend({ type: 'signup', email: sentTo, options: { emailRedirectTo: confirmUrl() } });
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
      {(error || query.error !== null) && (
        <p className="form-message form-error" role="alert">
          {error || LOGIN_ERRORS[query.error ?? ''] || 'That email or sign-in link could not be used. Please try again.'}
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

  if (mode === 'reset' && passwordSaved) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Password changed.</h1>
          <p className="auth-intro" role="status">You’re signed in. Use the new password the next time you log in.</p>
          <Link className="button auth-submit" href={dashboardPath()}>Continue to your projects</Link>
        </div>
      </div>
    );
  }

  if (mode === 'reset' && expired === null) {
    // The card's frame while the link's session is checked.
    return (
      <div className="auth-shell">
        <div className="auth-card" aria-busy="true">
          <h1>Checking your link…</h1>
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
          {mode === 'login' && loginIntro(query.next, next)}
          {mode === 'signup' && 'Start a project, work on branches, and keep every release locked.'}
          {mode === 'forgot' && 'Enter your account email and we’ll send a reset link.'}
          {mode === 'reset' && 'Choose a new password for your account.'}
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
          {mode === 'signup' && (
            <p className="auth-hint">
              By creating an account you agree to the <a href={`${siteUrl}/terms`}>Terms</a> and <a href={`${siteUrl}/privacy`}>Privacy Policy</a>.
            </p>
          )}
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
