'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { LogInAgain } from './ActionButton';

/** Reloads at most once per page in a short while, so a cookie the browser can't read never loops. */
function reloadOnce() {
  const key = `gigacad:session-reload:${window.location.pathname}`;
  try {
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Without storage, reloading once more is still better than showing a stale page.
  }
  window.location.reload();
  return true;
}

/**
 * Notices when the session this page was rendered for ends or changes in another tab.
 *
 * - Ending while the page is open: the page stays, with a notice, so nothing typed on it is
 *   lost. Moving to another page after that loads it from the server, which sends private
 *   pages to the login form.
 * - Already gone when the page appears (Back restoring it from the router's cache): the page
 *   is loaded again from the server instead of showing private content signed out.
 * - Signed in as someone else: the page would save as the wrong person, so it's blocked until
 *   it's reloaded.
 */
export function SessionWatch({ viewerId }: { viewerId: string }) {
  const pathname = usePathname();
  const [state, setState] = useState<'ok' | 'signed_out' | 'switched'>('ok');
  const signedOutAt = useRef<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const check = (userId: string | null | undefined, initial = false) => {
      if (!userId) {
        // The first report already without a session means this page came from the cache.
        if (initial && reloadOnce()) return;
        signedOutAt.current ??= window.location.pathname;
        setState('signed_out');
      } else setState(userId === viewerId ? 'ok' : 'switched');
    };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') check(null);
      else check(session?.user.id, event === 'INITIAL_SESSION');
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

  // Signed out and moving on (a link, or Back): ask the server for the page instead of the cache.
  useEffect(() => {
    if (state === 'signed_out' && signedOutAt.current && pathname !== signedOutAt.current) window.location.reload();
  }, [pathname, state]);

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
