'use client';

import { formatBytes } from '@gigacad/core';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { STORAGE_BANNER_COOKIE } from '../../lib/storage-banner';

/**
 * A thin warning across the work pane once the viewer's own storage is 80% used. It can be
 * dismissed for the session until storage is full; then uploads stop, so it stays.
 */
export function StorageBanner({ usedBytes, quotaBytes }: { usedBytes: number; quotaBytes: number }) {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const full = usedBytes >= quotaBytes;
  if (hidden || pathname.startsWith('/settings/billing')) return null;

  function dismiss() {
    document.cookie = `${STORAGE_BANNER_COOKIE}=dismissed; path=/; samesite=lax`;
    setHidden(true);
  }

  return (
    <div className={`storage-banner${full ? ' is-full' : ''}`} role={full ? 'alert' : 'status'}>
      <p>
        {full ? 'Your storage is full, so uploads are paused' : `Your storage is ${Math.floor((usedBytes / quotaBytes) * 100)}% full`}: {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} used.{' '}
        <Link href={`/settings/billing?from=${encodeURIComponent(pathname)}`}>Upgrade</Link>
      </p>
      {!full && (
        <button type="button" className="storage-banner-close" onClick={dismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}
