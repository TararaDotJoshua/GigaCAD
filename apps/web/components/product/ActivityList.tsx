import Link from 'next/link';
import type { Activity } from '../../lib/api';
import { commitPath, projectPath, releasePath, releaseRequestPath } from '../../lib/paths';
import { RelativeTime } from './RelativeTime';

const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A user's recent contributions, grouped by month, newest first. */
export function ActivityList({ activity }: { activity: readonly Activity[] }) {
  const months: { label: string; items: Activity[] }[] = [];
  for (const item of activity) {
    const label = monthFormat.format(new Date(item.createdAt));
    if (months.at(-1)?.label !== label) months.push({ label, items: [] });
    months.at(-1)!.items.push(item);
  }
  return (
    <div className="activity">
      {months.map((month) => (
        <section key={month.label} className="activity-month">
          <h3>{month.label}</h3>
          <ul className="activity-list">
            {month.items.map((item, index) => (
              <li key={`${item.kind}-${item.createdAt}-${index}`}>
                <p>
                  <Describe item={item} />
                </p>
                <span className="muted">
                  <RelativeTime value={item.createdAt} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Describe({ item }: { item: Activity }) {
  const { ownerHandle: owner, projectSlug: slug } = item;
  const project = (
    <Link href={projectPath(owner, slug)} className="mono">
      {owner}/{slug}
    </Link>
  );
  switch (item.kind) {
    case 'commit':
      return (
        <>
          Committed <Link href={commitPath(owner, slug, item.commitId!)}>{item.versionLabel ?? 'a version'}</Link> to{' '}
          <span className="mono">{item.branchName}</span> in {project}
          {item.title && <span className="activity-detail">{item.title}</span>}
        </>
      );
    case 'release_request':
      return (
        <>
          Opened <Link href={releaseRequestPath(owner, slug, item.number!)}>release request #{item.number}</Link> in {project}
          {item.title && <span className="activity-detail">{item.title}</span>}
        </>
      );
    case 'release':
      return (
        <>
          Released <Link href={releasePath(owner, slug, item.number!)}>v{item.number}</Link> of {project}
        </>
      );
    case 'approval':
      return (
        <>
          Approved <Link href={releaseRequestPath(owner, slug, item.number!)}>release request #{item.number}</Link> in {project}
        </>
      );
  }
}
