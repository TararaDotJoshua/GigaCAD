'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Refreshes the page a few times, e.g. while a payment webhook lands after Checkout.
 * Shows `after` once it has stopped trying.
 */
export function RefreshSoon({ times = 5, everyMs = 3000, after }: { times?: number; everyMs?: number; after?: React.ReactNode }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  useEffect(() => {
    let count = 0;
    const timer = setInterval(() => {
      router.refresh();
      if (++count >= times) {
        clearInterval(timer);
        setDone(true);
      }
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, times, everyMs]);
  return done ? after : null;
}
