'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../lib/api';
import { normalizeCode } from '../lib/device-code';
import { createClient } from '../lib/supabase/client';

const CODE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const MALFORMED = 'Codes look like ABCD-2345: eight letters and digits.';
const GONE = 'This code expired or was already used. Start signing in again on your device (for the CLI, run giga login) to get a new code.';

/** Words for an API refusal: a 404 means the code is gone, whatever the API calls it. */
function problem(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && cause.status === 404) return GONE;
  return cause instanceof Error ? cause.message : fallback;
}

/** `handle` is who the device will sign in as; null while it's still the generated placeholder. */
export function DeviceApproval({ handle, initialCode }: { handle: string | null; initialCode: string }) {
  const [code, setCode] = useState(normalizeCode(initialCode));
  const [pendingCode, setPendingCode] = useState('');
  const [clientName, setClientName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState('');
  const [denied, setDenied] = useState(false);

  async function token() {
    const supabase = createClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (!claims) throw new Error('Log in before approving a device.');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Log in before approving a device.');
    return session.access_token;
  }

  async function inspect(value: string) {
    setClientName(''); setPendingCode(''); setError('');
    if (!CODE.test(value)) return setError(MALFORMED);
    setBusy(true);
    try {
      const pending = await apiRequest<{clientName: string; expiresAt: string}>(await token(), `/v1/auth/device/pending/${value}`);
      setClientName(pending.clientName); setExpiresAt(pending.expiresAt); setPendingCode(value);
    } catch (cause) { setError(problem(cause, 'This code is unavailable.')); }
    finally { setBusy(false); }
  }

  useEffect(() => { if (code) void inspect(code); }, []);

  async function lookUp(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await inspect(code); }
  async function approve() {
    if (!pendingCode || pendingCode !== code) return;
    setBusy(true); setError('');
    try {
      await apiRequest(await token(), '/v1/auth/device/approve', { method: 'POST', body: JSON.stringify({ userCode: pendingCode }) });
      setApproved(clientName);
    } catch (cause) { setError(problem(cause, 'Could not approve this device.')); }
    finally { setBusy(false); }
  }
  async function deny() {
    if (!pendingCode) return;
    setBusy(true); setError('');
    try {
      await apiRequest(await token(), '/v1/auth/device/deny', { method: 'POST', body: JSON.stringify({ userCode: pendingCode }) });
      setDenied(true);
    } catch (cause) { setError(problem(cause, 'Could not turn down this sign-in.')); }
    finally { setBusy(false); }
  }
  /** Signs this browser out (only this one) and comes back to the same code as someone else. */
  async function switchAccount() {
    await createClient().auth.signOut({ scope: 'local' });
    const back = code ? `/device?code=${encodeURIComponent(code)}` : '/device';
    window.location.assign(`/login?next=${encodeURIComponent(back)}`);
  }

  if (approved) {
    return <div className="auth-shell"><div className="auth-card"><h1>Device approved.</h1><p className="auth-intro">“{approved}” is signed in{handle ? ` as @${handle}` : ''}. You can close this tab and go back to it.</p><p className="auth-hint">You can sign devices out any time from <a href="/settings#devices">Account settings</a>.</p></div></div>;
  }
  if (denied) {
    return <div className="auth-shell"><div className="auth-card"><h1>Sign-in turned down.</h1><p className="auth-intro">{clientName ? `“${clientName}”` : 'The device'} wasn’t signed in, and its code no longer works. If you didn’t start this, nothing else is needed.</p></div></div>;
  }

  const found = Boolean(clientName && pendingCode === code);
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Approve a device.</h1>
        <p className="auth-intro">Only approve a code shown on a device you are using.</p>
        {handle && (
          <p className="auth-hint">
            Signed in as <strong>@{handle}</strong>. Not you?{' '}
            <button type="button" className="auth-link-button" onClick={() => void switchAccount()}>Use another account</button>
          </p>
        )}
        <form onSubmit={lookUp} className="auth-form">
          <label>
            Sign-in code
            <input
              value={code}
              onChange={(event) => { setCode(normalizeCode(event.target.value)); setClientName(''); setPendingCode(''); setError(''); }}
              placeholder="ABCD-2345"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
          </label>
          {!found && <button type="submit" className="button auth-submit" disabled={busy}>Look up code</button>}
          {error && <p className="form-message form-error" role="alert">{error}</p>}
        </form>
        {found && (
          <div className="device-request">
            <p>
              A device that calls itself “{clientName}” wants to sign in to your GigaCAD account{handle ? <> as <strong>@{handle}</strong></> : null}. The device
              chose that name, so only approve if the code matches the one it shows you.
            </p>
            <p>Code <span className="mono">{pendingCode}</span> · Expires {new Date(expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
            <button type="button" className="button auth-submit" disabled={busy} onClick={approve}>Approve this device</button>
            <div className="auth-links">
              <button type="button" className="auth-link-button" disabled={busy} onClick={() => void deny()}>This isn’t me</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
