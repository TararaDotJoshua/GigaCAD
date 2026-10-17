'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { createClient } from '../../lib/supabase/client';

/**
 * Refreshes the page when anything happens in the project (a checkout, an approval,
 * a release), using Supabase Realtime on the project's event feed.
 */
export function LiveRefresh({ projectId }: { projectId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let channel: RealtimeChannel | undefined;
    let cancelled = false;
    let startedSignedIn = false;
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
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_events', filter: `project_id=eq.${projectId}` }, () => {
          clearTimeout(timer);
          timer = setTimeout(refresh, 300);
        })
        .subscribe();
    })();
    // Refreshed after its session ended, a page would turn into the login page and lose what
    // was typed on it; the shell says the session ended instead (SessionWatch). A visitor who
    // was never signed in, on a public project, keeps getting updates.
    async function refresh() {
      if (!startedSignedIn || (await supabase.auth.getSession()).data.session) router.refresh();
    }
    const { data: auth } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT' || !startedSignedIn) return;
      clearTimeout(timer);
      if (channel) void supabase.removeChannel(channel);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      auth.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [projectId, router]);
  return null;
}
