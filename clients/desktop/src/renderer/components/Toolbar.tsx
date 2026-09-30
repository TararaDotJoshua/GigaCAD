import { useEffect, useState, type ReactNode } from 'react';
import type { AppState } from '../../shared/types.js';
import { ago } from '../api.js';
import { AlertIcon, CheckIcon, SyncIcon } from '../icons.js';

/** The top of the main column: what's selected, its actions, and the sync status. */
export function Toolbar({ state, eyebrow, title, children }: { state: AppState; eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="toolbar drag">
      <div className="toolbar-title">
        <span className="project">{eyebrow}</span>
        <span className="branch">{title}</span>
      </div>
      {children}
      <SyncStatus state={state} />
    </header>
  );
}

export function SyncStatus({ state }: { state: AppState }) {
  const { sync } = state;
  // Re-render every half minute so "Synced 2 min ago" stays true between state updates.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (sync.status === 'syncing') {
    return (
      <span className="sync-status" role="status">
        <SyncIcon className="icon spin" />
        Syncing
      </span>
    );
  }
  if (sync.status === 'error' || sync.status === 'offline') {
    return (
      <span className="sync-status is-problem" role="status" title={sync.message ?? undefined}>
        <AlertIcon className="icon" />
        {sync.status === 'offline' ? 'Offline' : 'Sync problem'}
      </span>
    );
  }
  if (sync.status === 'paused') return <span className="sync-status">Paused</span>;
  return (
    <span className="sync-status" title={sync.lastSyncedAt ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()}` : undefined}>
      <CheckIcon className="icon" />
      Synced {ago(sync.lastSyncedAt)}
    </span>
  );
}
