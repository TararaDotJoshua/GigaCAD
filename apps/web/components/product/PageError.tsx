'use client';

import { useEffect, useState } from 'react';
import { dashboardPath } from '../../lib/hosts';
import { createClient } from '../../lib/supabase/client';
import { ProblemPanel } from './ProblemPanel';

/**
 * A product page that failed to render. When the cause is a session that ended, it says so
 * and offers to log in again, instead of blaming the server and offering a retry that fails too.
 */
export function PageError({ reset }: { reset: () => void }) {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    void createClient()
      .auth.getSession()
      .then(({ data }) => setSignedOut(!data.session));
  }, []);
  if (signedOut) {
    const next = window.location.pathname + window.location.search;
    return (
      <ProblemPanel
        title="You’ve been signed out"
        home={dashboardPath()}
        action={
          <a className="btn btn-primary" href={`/login?next=${encodeURIComponent(next)}`}>
            Log in again
          </a>
        }
      >
        <p>Your session ended, maybe in another tab. Log in again to come back to this page.</p>
      </ProblemPanel>
    );
  }
  return (
    <ProblemPanel title="This page didn’t load" home={dashboardPath()} action={<button type="button" className="btn btn-primary" onClick={reset}>Try again</button>}>
      <p>Something went wrong on our side. Your files are safe. Try again in a moment.</p>
    </ProblemPanel>
  );
}
