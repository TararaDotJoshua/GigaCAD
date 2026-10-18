'use client';

import { useEffect, useState } from 'react';
import { readSignedIn } from '../lib/signed-in';
import { createClient } from '../lib/supabase/client';

/**
 * "Log in", or "Your projects" once the browser finds a session. Checked in the browser so the
 * page around it can stay static.
 */
export function AccountLink({ dashboard, login }: { dashboard: string; login: string }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    // The app's marker cookie reaches gigacad.site, where the app's own session cookies don't.
    if (readSignedIn()) return setSignedIn(true);
    let current = true;
    void createClient()
      .auth.getSession()
      .then(({ data }) => current && setSignedIn(Boolean(data.session)))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  return signedIn ? <a href={dashboard}>Your projects</a> : <a href={login}>Log in</a>;
}
