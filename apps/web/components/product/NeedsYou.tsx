import Link from 'next/link';
import type { NeedsYou as Pending } from '../../lib/needs-you';
import { STALE_LOCK_DAYS } from '../../lib/needs-you';
import { branchPath, releaseRequestPath } from '../../lib/paths';
import { RelativeTime } from './RelativeTime';

/** The top of the dashboard: requests to approve or release, and locks to give back or take back. */
export function NeedsYou({ pending }: { pending: Pending }) {
  const count = pending.approve.length + pending.release.length + pending.locks.length + pending.stale.length;
  return (
    <section className="section needs-you" aria-labelledby="needs-you-heading">
      <h2 id="needs-you-heading">Needs you{count ? <span className="app-nav-count needs-you-count">{count}</span> : null}</h2>
      {count === 0 ? (
        <p className="muted">Nothing is waiting on you. Release requests to approve and branches you have checked out show up here.</p>
      ) : (
        <ul className="needs-you-list">
          {pending.approve.map(({ project, request }) => (
            <li key={`approve-${request.id}`}>
              <Link href={releaseRequestPath(project.ownerHandle, project.slug, request.number)}>
                Review #{request.number} {request.title}
              </Link>
              <span className="muted">
                {project.name} · {request.requesterHandle ? `@${request.requesterHandle} asked for approval` : 'Waiting for approval'} · <RelativeTime value={request.updatedAt} />
              </span>
            </li>
          ))}
          {pending.release.map(({ project, request }) => (
            <li key={`release-${request.id}`}>
              <Link href={releaseRequestPath(project.ownerHandle, project.slug, request.number)}>
                Release #{request.number} {request.title}
              </Link>
              <span className="muted">{project.name} · Approved and ready to release</span>
            </li>
          ))}
          {pending.locks.map(({ project, branch }) => (
            <li key={`lock-${branch.id}`}>
              <Link href={branchPath(project.ownerHandle, project.slug, branch.name)}>
                You have <span className="mono">{branch.name}</span> checked out
              </Link>
              <span className="muted">
                {project.name}
                {branch.checkedOutMachine && ` · on ${branch.checkedOutMachine}`} · <RelativeTime value={branch.checkedOutAt} /> · Check it in when you’re done so others can work on it
              </span>
            </li>
          ))}
          {pending.stale.map(({ project, branch }) => (
            <li key={`stale-${branch.id}`}>
              <Link href={branchPath(project.ownerHandle, project.slug, branch.name)}>
                @{branch.checkedOutByHandle} has had <span className="mono">{branch.name}</span> checked out for over {STALE_LOCK_DAYS} days
              </Link>
              <span className="muted">
                {project.name} · Since <RelativeTime value={branch.checkedOutAt} /> · Ask them to check it in, or force-release the lock
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
