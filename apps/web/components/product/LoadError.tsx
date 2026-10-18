'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { dashboardPath } from '../../lib/hosts';
import { createClient } from '../../lib/supabase/client';
import { ProblemPanel } from './ProblemPanel';

const subscribe = (change: () => void) => {
  window.addEventListener('online', change);
  window.addEventListener('offline', change);
  return () => {
    window.removeEventListener('online', change);
    window.removeEventListener('offline', change);
  };
};

/**
 * An error page's body. When the browser is offline it says so, instead of blaming the server.
 * On pages that need a session (`needsSession`), a session that ended (in another tab, say)
 * gets a way to log in again, since a retry would fail the same way.
 */
export function LoadError({ reset, needsSession = false }: { reset: () => void; needsSession?: boolean }) {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    if (!needsSession) return;
    void createClient()
      .auth.getSession()
      .then(({ data }) => setSignedOut(!data.session));
  }, [needsSession]);
  if (online && signedOut) {
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
    <ProblemPanel title={online ? 'This page didn’t load' : 'You’re offline'} home={dashboardPath()} action={<button type="button" className="btn btn-primary" onClick={reset}>Try again</button>}>
      <p>{online ? 'Something went wrong on our side. Your files are safe. Try again in a moment.' : 'This page needs a connection. Reconnect, then try again. Your files are safe.'}</p>
    </ProblemPanel>
  );
}
