import { isReservedHandle } from '@gigacad/core';
import { restoreProject } from '../actions';
import { SiteNotFound } from '../../../components/SiteNotFound';
import { ActionButton } from '../../../components/product/ActionButton';
import { ProblemPanel } from '../../../components/product/ProblemPanel';
import { RelativeTime } from '../../../components/product/RelativeTime';
import { Shell } from '../../../components/product/Shell';
import { currentPath, loginPath } from '../../../lib/current-path';
import { dashboardPath } from '../../../lib/hosts';
import { getDeletedProjects } from '../../../lib/product';
import { getAccessToken } from '../../../lib/session';

const DAY_MS = 24 * 60 * 60 * 1000;

// Missing people and projects. Private projects look missing to people who can't see them.
export default async function NotFound() {
  const [, first, slug] = ((await currentPath()) ?? '').split(/[?#]/)[0]!.split('/');
  // Site pages like /docs/<missing> land here too; they get the site's own 404, not the product frame.
  if (first && isReservedHandle(first)) return <SiteNotFound section={first.toLowerCase()} />;
  const signedIn = Boolean(await getAccessToken());
  // A project you deleted still holds its address until it's purged; say so, and offer it back.
  const deleted =
    signedIn && slug
      ? (await getDeletedProjects().catch(() => [])).find((project) => project.ownerHandle === first?.toLowerCase() && project.slug === slug.toLowerCase())
      : undefined;
  if (deleted) {
    const days = Math.max(1, Math.ceil((new Date(deleted.purgeAt).getTime() - Date.now()) / DAY_MS));
    return (
      <Shell>
        <ProblemPanel
          title="You deleted this project"
          home={dashboardPath()}
          action={
            <ActionButton action={restoreProject.bind(null, deleted.id)} className="btn btn-primary" pendingLabel="Restoring…">
              Restore {deleted.name}
            </ActionButton>
          }
        >
          <p>
            You deleted <span className="mono">{deleted.ownerHandle}/{deleted.slug}</span> <RelativeTime value={deleted.deletedAt} />. It can be restored for {days} more{' '}
            {days === 1 ? 'day' : 'days'}, with its files, branches, and releases.
          </p>
        </ProblemPanel>
      </Shell>
    );
  }
  return (
    <Shell>
      <ProblemPanel title="Not found" home={dashboardPath()} login={signedIn ? undefined : await loginPath()}>
        {signedIn ? (
          <>
            <p>There’s no project or person at this address, or it’s private and your account doesn’t have access.</p>
            <p>Check the address, or ask the owner to add you.</p>
          </>
        ) : (
          <>
            <p>There’s no public project or person at this address.</p>
            <p>If this project was shared with you, log in to see it.</p>
          </>
        )}
      </ProblemPanel>
    </Shell>
  );
}
