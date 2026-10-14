import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { AppState } from '../../shared/types.js';
import { unreadErrors, useActivitySeenAt } from '../activity.js';
import { act, ago } from '../api.js';
import { AlertIcon, CheckIcon, SyncIcon } from '../icons.js';
import { ActivityList } from './Activity.js';
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

/** The sync status, as a button that opens Activity: everything that happened, with Sync now. */
export function SyncStatus({ state }: { state: AppState }) {
  const { sync } = state;
  const seen = useActivitySeenAt();
  const unread = unreadErrors(state.activity, seen).length;
  // Re-render every half minute so "Synced 2 min ago" stays true between state updates.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const problem = sync.status === 'error' || sync.status === 'offline';
  const label =
    sync.status === 'syncing'
      ? sync.active > 1
        ? `Syncing · ${sync.active}`
        : 'Syncing'
      : sync.status === 'offline'
        ? 'Offline'
        : sync.status === 'error'
          ? 'Sync problem'
          : sync.status === 'paused'
            ? 'Paused'
            : `Synced ${ago(sync.lastSyncedAt)}`;
  const icon = sync.status === 'syncing' ? <SyncIcon className="icon spin" /> : problem ? <AlertIcon className="icon" /> : sync.status === 'paused' ? null : <CheckIcon className="icon" />;
  const tooltip = [
    problem ? (sync.message ?? label) : label,
    sync.lastSyncedAt && sync.status !== 'idle' ? `Last synced ${ago(sync.lastSyncedAt)}` : null,
    unread > 0 ? `${unread} new ${unread === 1 ? 'problem' : 'problems'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Popover
      label={label}
      title={tooltip}
      triggerClass={`sync-status${problem || unread > 0 ? ' is-problem' : ''}`}
      trigger={
        <>
          {icon}
          <span className="sync-label">{label}</span>
          {unread > 0 ? <span className="dot dot-danger" aria-label={`${unread} new`} /> : null}
        </>
      }
      render={(close) => (
        <div className="popover-body activity-popover" role="dialog" aria-label="Activity">
          <div className="popover-head">
            <div>
              <div className="strong">{problem ? label : 'Activity'}</div>
              <div className="faint">
                {problem ? (sync.message ?? (sync.status === 'offline' ? 'GigaCAD can’t reach gigacad.site.' : 'The last sync didn’t finish.')) : null}
                {problem ? ' · ' : null}
                Last synced {ago(sync.lastSyncedAt)}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={sync.status === 'syncing'}
              onClick={() => {
                close();
                void act('syncNow');
              }}
            >
              {problem ? 'Try again' : 'Sync now'}
            </button>
          </div>
          <div className="activity-scroll">
            <ActivityList state={state} items={state.activity} onOpen={close} markSeen />
          </div>
        </div>
      )}
    />
  );
}
