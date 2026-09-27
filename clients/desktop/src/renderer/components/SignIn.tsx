import type { AppState } from '../../shared/types.js';
import { act } from '../api.js';
import { Logo } from '../icons.js';

/** Device sign-in through `giga login`: the code shows here and the browser opens to approve it. */
export function SignIn({ state }: { state: AppState }) {
  const pending = state.signIn;
  return (
    <div className="center drag">
      <div className="card">
        <Logo />
        {pending ? (
          <>
            <h2 className="card-title">Confirm this code in your browser</h2>
            <p className="lede">Your browser opened {pending.verificationUri}. Check that it shows this code, then approve.</p>
            <div className="code" aria-label="Sign-in code">
              {pending.userCode}
            </div>
            <div className="inline">
              <button type="button" className="btn btn-secondary" onClick={() => void act('openExternal', pending.verificationUri)}>
                Open the page again
              </button>
              <button type="button" className="link" onClick={() => void act('cancelSignIn')}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="card-title">Sign in to GigaCAD</h2>
            <p className="lede">
              Your projects appear in Finder, in the GigaCAD folder. Signing in here also signs in the <span className="mono">giga</span> command
              line tool on this Mac.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => void act('signIn')}>
              Sign in with your browser
            </button>
          </>
        )}
      </div>
    </div>
  );
}
