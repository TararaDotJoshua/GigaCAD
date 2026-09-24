'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
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
  const next = safeReturnPath(search.get('next'));
  const nextQuery = `?next=${encodeURIComponent(next)}`;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const oauthProviders = [
    process.env.NEXT_PUBLIC_GITHUB_AUTH_ENABLED === 'true' ? 'github' : null,
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true' ? 'google' : null,
  ].filter((provider): provider is 'github' | 'google' => provider !== null);

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
        const redirect = new URL(next, window.location.origin);
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect.toString() } });
        if (error) throw error;
        if (data.session) {
          router.push(next);
          router.refresh();
        } else setNotice('Check your email to confirm your account, then return here to log in.');
      } else if (mode === 'forgot') {
        const redirect = new URL('/reset-password', window.location.origin);
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirect.toString() });
        if (error) throw error;
        setNotice('If this email has an account, a reset link is on its way.');
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        router.push('/app');
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Try again.');
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
      setError(cause instanceof Error ? cause.message : 'Could not start sign-in.');
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <p className="auth-kicker">GigaCAD</p>
        <h1>{titles[mode]}</h1>
        <p className="auth-intro">
          {mode === 'login' && 'Pick up where you left off with your projects and releases.'}
          {mode === 'signup' && 'Start a project, work on branches, and keep every release locked.'}
          {mode === 'forgot' && 'Enter your account email and we’ll send a reset link.'}
          {mode === 'reset' && 'Your new password will be used the next time you log in.'}
        </p>
        <form onSubmit={submit} className="auth-form">
          {mode !== 'reset' && <label>Email<input type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>}
          {mode !== 'forgot' && <label>{mode === 'reset' ? 'New password' : 'Password'}<input type="password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>}
          {(mode === 'signup' || mode === 'reset') && <label>Confirm password<input type="password" name="confirm" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>}
          {(error || search.has('error')) && <p className="form-message form-error" role="alert">{error || 'That email or sign-in link could not be used. Please try again.'}</p>}
          {notice && <p className="form-message form-success" role="status">{notice}</p>}
          <button className="button auth-submit" type="submit" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Save password'}</button>
        </form>
        {(mode === 'login' || mode === 'signup') && oauthProviders.length > 0 && <>
          <div className="auth-divider"><span>or continue with</span></div>
          <div className="auth-social">
            {oauthProviders.map((provider) => <button key={provider} type="button" onClick={() => oauth(provider)} disabled={busy}>{provider === 'github' ? 'GitHub' : 'Google'}</button>)}
          </div>
        </>}
        <div className="auth-links">
          {mode === 'login' && <><Link href={`/signup${nextQuery}`}>Create an account</Link><Link href="/forgot-password">Forgot password?</Link></>}
          {mode === 'signup' && <Link href={`/login${nextQuery}`}>Already have an account? Log in</Link>}
          {(mode === 'forgot' || mode === 'reset') && <Link href="/login">Back to log in</Link>}
        </div>
      </div>
    </div>
  );
}
