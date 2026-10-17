'use client';

import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { LogInAgain } from './ActionButton';

/**
 * Notices when the session this page was rendered for ends or changes in another tab. A
 * signed-out page stays put with a notice, so nothing typed on it is lost. A page showing
 * one account while the browser is signed in as another would save as the wrong person,
 * so that blocks the page until it's reloaded.
 */
export function SessionWatch({ viewerId }: { viewerId: string }) {
  const [state, setState] = useState<'ok' | 'signed_out' | 'switched'>('ok');
  useEffect(() => {
    const supabase = createClient();
    const check = (userId: string | null | undefined) => setState(!userId ? 'signed_out' : userId === viewerId ? 'ok' : 'switched');
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Token refreshes and the first report change nothing unless the person changed.
      if (event === 'SIGNED_OUT') check(null);
      else check(session?.user.id);
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') void supabase.auth.getSession().then(({ data: { session } }) => check(session?.user.id));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      data.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [viewerId]);

  if (state === 'signed_out') {
    return (
      <div className="session-banner" role="alert">
        <p>
          You’ve been signed out. Log in again to keep working; anything you typed on this page stays here. <LogInAgain />
        </p>
      </div>
    );
  }
  if (state === 'switched') {
    return (
      <div className="session-blocker" role="alertdialog" aria-modal="true" aria-labelledby="session-switched">
        <div className="session-blocker-card">
          <h2 id="session-switched">You switched accounts in another tab</h2>
          <p>This page belongs to the account you were signed in as before. Reload it to continue as the account you’re signed in as now.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()} autoFocus>
            Reload
          </button>
        </div>
      </div>
    );
  }
  return null;
}
