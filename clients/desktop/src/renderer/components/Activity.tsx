import { useContext, useEffect } from 'react';
import type { ActivityItem, AppState } from '../../shared/types.js';
import { SelectContext, markActivitySeen } from '../activity.js';
import { ago } from '../api.js';
import { AlertIcon } from '../icons.js';

/** Activity, newest first. Entries about a project or branch link to it. The full list marks everything seen. */
export function ActivityList({ state, items, onOpen, markSeen = false }: { state: AppState; items: readonly ActivityItem[]; onOpen?: () => void; markSeen?: boolean }) {
  const select = useContext(SelectContext);
  const newest = items[0]?.at;
  useEffect(() => {
    if (markSeen && newest) markActivitySeen(newest);
  }, [markSeen, newest]);
  if (items.length === 0) return <div className="empty">Nothing yet. Checkouts, autosaves, versions and downloads show up here.</div>;
  return (
    <ul className="rows activity">
      {items.map((item, index) => {
        const project = item.projectId ? state.projects.find((candidate) => candidate.id === item.projectId) : undefined;
        const where = project ? (item.branch ? `${project.name} / ${item.branch}` : project.name) : null;
        return (
          <li key={`${item.at}:${index}`} className={item.kind === 'error' ? 'is-error' : undefined}>
            {item.kind === 'error' ? <AlertIcon className="icon" /> : null}
            <div className="grow">
              <div className="activity-text">{item.text}</div>
              {where ? (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    onOpen?.();
                    select({ kind: 'project', projectId: project!.id, branch: item.branch });
                  }}
                >
                  {where}
                </button>
              ) : null}
            </div>
            <span className="faint" title={new Date(item.at).toLocaleString()}>
              {ago(item.at)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
