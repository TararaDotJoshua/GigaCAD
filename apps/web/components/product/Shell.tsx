import { STORAGE_WARNING_SHARE } from '@gigacad/core';
import { cookies } from 'next/headers';
import type { Project } from '../../lib/api';
import { dashboardPath } from '../../lib/hosts';
import { getBilling, getBranches, getMyProjectsIfSignedIn, getReleaseRequests, getViewer } from '../../lib/product';
import { Announcer } from './Announcer';
import { SidebarNav, type NavProject } from './SidebarNav';
import { SessionWatch } from './SessionWatch';
import { STORAGE_BANNER_COOKIE } from '../../lib/storage-banner';
import { StorageBanner } from './StorageBanner';


/**
 * The product frame: a Forest sidebar and a Paper work pane, the hero window at full
 * size. With a project, the sidebar expands it into its sections and open branches.
 */
export async function Shell({ project, children }: { project?: Project; children: React.ReactNode }) {
  const [me, projects, branches, requests] = await Promise.all([
    getViewer(),
    getMyProjectsIfSignedIn(),
    project ? getBranches(project.id) : Promise.resolve([]),
    project ? getReleaseRequests(project.id) : Promise.resolve([]),
  ]);

  const current: NavProject | undefined = project && {
    owner: project.ownerHandle,
    slug: project.slug,
    name: project.name,
    canManage: project.role === 'owner' || project.role === 'maintainer',
    activeRequests: requests.filter((request) => request.status === 'open' || request.status === 'candidate').length,
    branches: branches
      .filter((branch) => branch.status === 'open' || branch.status === 'frozen')
      .map((branch) => ({
        name: branch.name,
        frozen: branch.status === 'frozen',
        holder: me && branch.checkedOutBy === me.id ? ('you' as const) : branch.checkedOutByHandle,
        since: branch.checkedOutAt,
      })),
  };
  const storage = me ? await storageWarning() : null;
  const list = projects.map((p) => ({ owner: p.ownerHandle, slug: p.slug, name: p.name }));
  // A public project you're not a member of still gets its own entry.
  if (current && !list.some((p) => p.owner === current.owner && p.slug === current.slug)) list.unshift(current);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SidebarNav me={me && { handle: me.handle, avatarUrl: me.avatarUrl }} home={me ? dashboardPath() : '/explore'} projects={list} current={current} />
      <main id="main" className="shell-pane">
        {me && <SessionWatch viewerId={me.id} />}
        {storage && <StorageBanner usedBytes={storage.usedBytes} quotaBytes={storage.quotaBytes} billingEnabled={storage.billingEnabled} home={dashboardPath()} />}
        {children}
        <Announcer />
      </main>
    </div>
  );
}

/** The viewer's storage when it's nearly or entirely used, unless they dismissed the warning this session. */
async function storageWarning(): Promise<{ usedBytes: number; quotaBytes: number; billingEnabled: boolean } | null> {
  const billing = await getBilling().catch(() => null);
  if (!billing || billing.quotaBytes <= 0 || billing.usedBytes < billing.quotaBytes * STORAGE_WARNING_SHARE) return null;
  const full = billing.usedBytes >= billing.quotaBytes;
  if (!full && (await cookies()).get(STORAGE_BANNER_COOKIE)?.value === 'dismissed') return null;
  return { usedBytes: billing.usedBytes, quotaBytes: billing.quotaBytes, billingEnabled: billing.billingEnabled };
}
