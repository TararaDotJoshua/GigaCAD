import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { AppState } from '../../shared/types.js';
import { act, ago } from '../api.js';
import { AlertIcon, CheckIcon, SyncIcon } from '../icons.js';
import { Popover } from './Menu.js';

/** One step of the breadcrumb. The last is where you are; earlier ones can be clickable. */
export interface Crumb {
  readonly label: string;
  readonly onClick?: () => void;
}

/** The top of the main column: where you are, its state, its actions, and the sync status. */
export function Toolbar({ state, crumbs, chip, children }: { state: AppState; crumbs: readonly Crumb[]; chip?: ReactNode; children?: ReactNode }) {
  return (
    <header className="toolbar drag">
      <nav className="toolbar-title" aria-label="Location">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={`${index}:${crumb.label}`}>
              {index > 0 ? <span className="crumb-sep" aria-hidden="true">/</span> : null}
              {last ? (
                <h1 className="crumb is-current" title={crumb.label}>
                  {crumb.label}
                </h1>
              ) : crumb.onClick ? (
                <button type="button" className="crumb" title={crumb.label} onClick={crumb.onClick}>
                  {crumb.label}
                </button>
              ) : (
                <span className="crumb" title={crumb.label}>
                  {crumb.label}
                </span>
              )}
            </Fragment>
          );
        })}
        {chip}
      </nav>
      {children}
      <SyncStatus state={state} />
    </header>
  );
}

/** The sync status, as a button: a click syncs now, or explains a problem. */
export function SyncStatus({ state }: { state: AppState }) {
  const { sync } = state;
  // Re-render every half minute so "Synced 2 min ago" stays true between state updates.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (sync.status === 'syncing') {
    const label = sync.active > 1 ? `Syncing · ${sync.active}` : 'Syncing';
    return (
      <span className="sync-status" role="status" title={sync.active > 1 ? `${sync.active} tasks running` : undefined}>
        <SyncIcon className="icon spin" />
        <span className="sync-label">{label}</span>
      </span>
    );
  }
  if (sync.status === 'error' || sync.status === 'offline') {
    const label = sync.status === 'offline' ? 'Offline' : 'Sync problem';
    return (
      <Popover
        label={label}
        title={sync.message ?? label}
        triggerClass="sync-status is-problem"
        trigger={
          <>
            <AlertIcon className="icon" />
            <span className="sync-label">{label}</span>
          </>
        }
        render={(close) => (
          <div className="popover-body" role="dialog" aria-label={label}>
            <div className="strong">{label}</div>
            <p className="muted">{sync.message ?? (sync.status === 'offline' ? 'GigaCAD can’t reach gigacad.site.' : 'The last sync didn’t finish.')}</p>
            <p className="faint">Last synced {ago(sync.lastSyncedAt)}</p>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => {
                close();
                void act('syncNow');
              }}
            >
              Try again
            </button>
          </div>
        )}
      />
    );
  }
  if (sync.status === 'paused') {
    return (
      <span className="sync-status" role="status">
        <span className="sync-label">Paused</span>
      </span>
    );
  }
  const synced = `Synced ${ago(sync.lastSyncedAt)}`;
  return (
    <button
      type="button"
      className="sync-status"
      title={`${synced}${sync.lastSyncedAt ? ` · ${new Date(sync.lastSyncedAt).toLocaleString()}` : ''}. Click to sync now.`}
      onClick={() => void act('syncNow')}
    >
      <CheckIcon className="icon" />
      <span className="sync-label">{synced}</span>
    </button>
  );
}
