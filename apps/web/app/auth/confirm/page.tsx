import { confirmEmail } from './actions';

export const metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' as const };

export default async function Page({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; next?: string }> }) {
  const { token_hash, type, next } = await searchParams;
  const valid = Boolean(token_hash && (type === 'email' || type === 'recovery'));
  return <main className="auth-shell"><div className="auth-card"><p className="auth-kicker">GigaCAD</p><h1>{type === 'recovery' ? 'Reset your password.' : 'Confirm your email.'}</h1><p className="auth-intro">{valid ? 'Continue to finish this request.' : 'This link is incomplete. Request a new email and try again.'}</p>{valid && <form action={confirmEmail}><input type="hidden" name="token_hash" value={token_hash} /><input type="hidden" name="type" value={type} /><input type="hidden" name="next" value={next ?? ''} /><button className="button auth-submit" type="submit">Continue</button></form>}</div></main>;
}
