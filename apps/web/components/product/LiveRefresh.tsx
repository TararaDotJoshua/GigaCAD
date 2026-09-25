'use client';

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
    const channel = supabase
      .channel(`project-${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_events', filter: `project_id=eq.${projectId}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 300);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [projectId, router]);
  return null;
}
