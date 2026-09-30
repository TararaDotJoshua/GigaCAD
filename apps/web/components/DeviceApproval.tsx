'use client';

import { useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { createClient } from '../lib/supabase/client';

/** `handle` is who the device will sign in as; null while it's still the generated placeholder. */
export function DeviceApproval({ handle }: { handle: string | null }) {
  const search = useSearchParams();
  const [code, setCode] = useState((search.get('code') ?? '').toUpperCase());
  const [pendingCode, setPendingCode] = useState('');
  const [clientName, setClientName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState('');

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
    if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(value)) return;
    setBusy(true);
    try {
      const pending = await apiRequest<{clientName: string; expiresAt: string}>(await token(), `/v1/auth/device/pending/${value}`);
      setClientName(pending.clientName); setExpiresAt(pending.expiresAt); setPendingCode(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This code is unavailable.'); }
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not approve this device.'); }
    finally { setBusy(false); }
  }

  if (approved) {
    return <div className="auth-shell"><div className="auth-card"><h1>Device approved.</h1><p className="auth-intro">{approved} is signed in{handle ? ` as @${handle}` : ''}. You can close this tab and go back to it.</p><p className="auth-hint">You can sign devices out any time from Account settings.</p></div></div>;
  }

  return <div className="auth-shell"><div className="auth-card"><h1>Approve a device.</h1><p className="auth-intro">Only approve a code shown on a device you are using.</p>{handle && <p className="auth-hint">Signed in as <strong>@{handle}</strong>. Not you? Log out first.</p>}<form onSubmit={lookUp} className="auth-form"><label>Sign-in code<input value={code} onChange={(event) => { setCode(event.target.value.toUpperCase()); setClientName(''); setPendingCode(''); }} placeholder="ABCD-2345" maxLength={9} required /></label><button type="submit" className="button auth-submit" disabled={busy}>Look up code</button>{error && <p className="form-message form-error" role="alert">{error}</p>}</form>{clientName && pendingCode === code && <div className="device-request"><p><strong>{clientName}</strong> wants to sign in to your GigaCAD account{handle ? <> as <strong>@{handle}</strong></> : null}.</p><p>Code <span className="mono">{pendingCode}</span> · Expires {new Date(expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p><button type="button" className="button auth-submit" disabled={busy} onClick={approve}>Approve {clientName}</button></div>}</div></div>;
}
