import type { Project } from '../../lib/api';
import { dashboardPath } from '../../lib/hosts';
import { getBranches, getMyProjectsIfSignedIn, getReleaseRequests, getViewer } from '../../lib/product';
import { SidebarNav, type NavProject } from './SidebarNav';

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
        holder: me && branch.checkedOutBy === me.id ? ('you' as const) : branch.checkedOutByHandle,
      })),
  };
  const list = projects.map((p) => ({ owner: p.ownerHandle, slug: p.slug, name: p.name }));
  // A public project you're not a member of still gets its own entry.
  if (current && !list.some((p) => p.owner === current.owner && p.slug === current.slug)) list.unshift(current);

  return (
    <div className="shell">
      <SidebarNav me={me && { handle: me.handle }} home={me ? dashboardPath() : '/explore'} projects={list} current={current} />
      <main id="main" className="shell-pane">
        {children}
      </main>
    </div>
  );
}
