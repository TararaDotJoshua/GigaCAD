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
    void (async () => {
      // Load the session and hand its token to Realtime before joining. Otherwise the
      // channel joins as anonymous and row-level security hides private projects' events.
      // The client keeps the token current on refresh from then on.
      const { data } = await supabase.auth.getSession();
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;
      channel = supabase
        .channel(`project-${projectId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_events', filter: `project_id=eq.${projectId}` }, () => {
          clearTimeout(timer);
          timer = setTimeout(() => router.refresh(), 300);
        })
        .subscribe();
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [projectId, router]);
  return null;
}
