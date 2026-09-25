'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Refreshes the page a few times, e.g. while a payment webhook lands after Checkout. */
export function RefreshSoon({ times = 5, everyMs = 3000 }: { times?: number; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const timer = setInterval(() => {
      router.refresh();
      if (++count >= times) clearInterval(timer);
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, times, everyMs]);
  return null;
}
