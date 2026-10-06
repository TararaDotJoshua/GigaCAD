import { SubmitButton } from '../../../../components/SubmitButton';
import { confirmEmail } from './actions';

export const metadata = { title: 'Confirm your email', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };

export default async function Page({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; next?: string }> }) {
  const { token_hash, type, next } = await searchParams;
  const valid = Boolean(token_hash && (type === 'email' || type === 'recovery' || type === 'email_change'));
  const recovery = type === 'recovery';
  const change = type === 'email_change';
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>{recovery ? 'Reset your password.' : change ? 'Confirm your new email.' : 'Confirm your email.'}</h1>
        <p className="auth-intro">
          {!valid
            ? 'This link is incomplete. Request a new email and try again.'
            : recovery
              ? 'Continue to choose a new password.'
              : change
                ? 'Continue to confirm the change. It finishes once both addresses have confirmed.'
                : 'Continue to confirm your address and sign in.'}
        </p>
        {valid && (
          <form action={confirmEmail}>
            <input type="hidden" name="token_hash" value={token_hash} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="next" value={next ?? ''} />
            <SubmitButton className="button auth-submit" pendingLabel={recovery ? 'Checking link…' : 'Confirming…'}>
              Continue
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
