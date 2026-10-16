'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Refreshes the page when its tab comes back into view, so new shares and requests show without a reload. */
export function RefreshOnFocus({ minIntervalMs = 15_000 }: { minIntervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < minIntervalMs) return;
      last = Date.now();
      router.refresh();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [router, minIntervalMs]);
  return null;
}
