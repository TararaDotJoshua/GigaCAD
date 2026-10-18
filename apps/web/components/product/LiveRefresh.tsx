'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { refreshesPage } from '../../lib/live';
import { createClient } from '../../lib/supabase/client';

/** Events are gathered this long before refreshing, so a burst of them is one refresh. */
const DEBOUNCE_MS = 2000;
/** A tab hidden this long re-checks the page when it's shown again, in case access was lost meanwhile. */
const STALE_MS = 60_000;

/**
 * Refreshes the page when something happens in the project (a checkout, an approval,
 * a release), using Supabase Realtime on the project's event feed. Autosaves only refresh
 * branch pages, and a hidden tab waits until it's shown again.
 */
export function LiveRefresh({ projectId }: { projectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let channel: RealtimeChannel | undefined;
    let cancelled = false;
    let missed = false;
    let hiddenAt = document.hidden ? Date.now() : 0;
    let startedSignedIn = false;

    // Refreshed after its session ended, a page would turn into the login page and lose what
    // was typed on it; the shell says the session ended instead (SessionWatch). A visitor who
    // was never signed in, on a public project, keeps getting updates.
    const refreshIfSignedIn = async () => {
      if (!startedSignedIn || (await supabase.auth.getSession()).data.session) router.refresh();
    };
    const refresh = () => {
      if (document.hidden) {
        missed = true;
        return;
      }
      void refreshIfSignedIn();
    };
    const visibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (missed || (hiddenAt && Date.now() - hiddenAt > STALE_MS)) {
        missed = false;
        void refreshIfSignedIn();
      }
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', visibility);

    void (async () => {
      // Load the session and hand its token to Realtime before joining. Otherwise the
      // channel joins as anonymous and row-level security hides private projects' events.
      // The client keeps the token current on refresh from then on.
      const { data } = await supabase.auth.getSession();
      startedSignedIn = Boolean(data.session);
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;
      channel = supabase
        .channel(`project-${projectId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_events', filter: `project_id=eq.${projectId}` }, (change) => {
          if (!refreshesPage(change.new as { kind?: string; payload?: unknown }, path.current)) return;
          clearTimeout(timer);
          timer = setTimeout(refresh, DEBOUNCE_MS);
        })
        .subscribe();
    })();
    // Signing out (here or in another tab) drops the subscription at once, rather than when the token expires.
    const { data: auth } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return;
      clearTimeout(timer);
      void supabase.removeAllChannels();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
      auth.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [projectId, router]);
  return null;
}
