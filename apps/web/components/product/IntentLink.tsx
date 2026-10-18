'use client';

import Link from 'next/link';
import { useState, type ComponentProps } from 'react';

/**
 * A link that prefetches only once someone shows they may follow it, by pointing at it,
 * touching it, or tabbing to it. For long lists of links (sidebar projects and branches,
 * file rows), where prefetching all of them on sight would cost dozens of requests a page.
 */
export function IntentLink({ onMouseEnter, onFocus, onTouchStart, ...props }: Omit<ComponentProps<typeof Link>, 'prefetch'>) {
  const [wanted, setWanted] = useState(false);
  return (
    <Link
      {...props}
      prefetch={wanted ? null : false}
      onMouseEnter={(event) => {
        setWanted(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        setWanted(true);
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        setWanted(true);
        onTouchStart?.(event);
      }}
    />
  );
}
