'use client';

import { useEffect, useState } from 'react';
import { relative } from '../../lib/relative-time';

export { relative };

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

/** One shared clock for every relative time on the page. */
function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => listeners.forEach((tick) => tick()), TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/**
 * "3h ago" with the exact time on hover, kept current while the tab stays open. The server's
 * text shows first; once in the browser it ticks, and the hover shows the viewer's local time.
 * `compact` drops the "ago", for tight spots like the sidebar.
 */
export function RelativeTime({ value, compact = false }: { value: string | null | undefined; compact?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    return subscribe(() => setNow(new Date()));
  }, []);
  if (!value) return null;
  const date = new Date(value);
  const text = relative(date, now ?? new Date());
  return (
    // The server and the browser read the clock moments apart, so the first render may differ by a minute.
    <time dateTime={date.toISOString()} title={now ? date.toLocaleString() : date.toUTCString()} suppressHydrationWarning>
      {compact ? text.replace(/ ago$/, '') : text}
    </time>
  );
}
