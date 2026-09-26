import Link from 'next/link';
import { ForkIcon } from '../../../../components/icons';
import { PageHead } from '../../../../components/product/PageHead';
import { ProjectDirectory, TagsCard, type DirectoryParams } from '../../../../components/product/ProjectDirectory';
import { RelativeTime } from '../../../../components/product/RelativeTime';
import { StarButton } from '../../../../components/product/StarButton';
import { StatusBadge } from '../../../../components/product/StatusBadge';
import { describeEvent } from '../../../../lib/describe';
import { projectPath, releasePath, treePath } from '../../../../lib/paths';
import { getBranches, getEvents, getMembers, getProject, getTags, getViewer } from '../../../../lib/product';

/** The project page and its folders: the project's files, with tags and recent activity beside them. */
export async function ProjectFilesPage({ owner, slug, path, params }: { owner: string; slug: string; path: string; params: DirectoryParams }) {
  const project = await getProject(owner, slug);
  const [events, members, branches, tags, viewer] = await Promise.all([
    getEvents(project.id),
    getMembers(project.id),
    getBranches(project.id),
    getTags(project.id),
    getViewer(),
  ]);
  const handles = new Map(members.map((member) => [member.userId, member.handle]));
  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
  const activity = events
    .map((event) => ({
      event,
      text: describeEvent(event, {
        handle: (id) => (id && handles.has(id) ? `@${handles.get(id)}` : 'Someone'),
        branch: (id) => (id ? branchNames.get(id) : undefined),
      }),
    }))
    .filter((entry) => entry.text);

  return (
    <div className="page">
      <PageHead
        crumbs={[{ label: project.ownerHandle }, { label: project.name, href: path ? projectPath(owner, slug) : undefined }]}
        title={project.name}
        meta={
          <>
            <StatusBadge tone="quiet">{project.visibility === 'public' ? 'Public' : 'Private'}</StatusBadge>
            <span className="mono">
              {project.ownerHandle}/{project.slug}
            </span>
            {project.forkedFrom && (
              <span>
                Forked from{' '}
                <Link className="mono" href={releasePath(project.forkedFrom.ownerHandle, project.forkedFrom.slug, project.forkedFrom.releaseNumber)}>
                  {project.forkedFrom.ownerHandle}/{project.forkedFrom.slug} v{project.forkedFrom.releaseNumber}
                </Link>
              </span>
            )}
            {project.latestReleaseNumber && (
              <Link href={treePath(owner, slug, `Releases/v${project.latestReleaseNumber}`)}>Latest release v{project.latestReleaseNumber}</Link>
            )}
            {project.description && <span>{project.description}</span>}
          </>
        }
        actions={
          <>
            <StarButton projectId={project.id} starred={project.starred} count={project.starCount} signedIn={!!viewer} next={projectPath(owner, slug)} />
            {project.latestReleaseNumber && (
              <Link href={projectPath(owner, slug, 'fork')} className="btn btn-secondary" title={project.forkCount ? `${project.forkCount} public ${project.forkCount === 1 ? 'fork' : 'forks'}` : undefined}>
                <ForkIcon className="icon" />
                Fork{project.forkCount ? ` ${project.forkCount}` : ''}
              </Link>
            )}
          </>
        }
      />
      <div className="page-grid">
        <section aria-label="Files">
          <ProjectDirectory project={project} path={path} params={params} signedIn={!!viewer} />
        </section>

        <div className="side-stack">
          <TagsCard project={project} tags={tags} />
          <aside className="side" aria-label="Recent activity">
            <h2 className="side-heading">Activity</h2>
            {activity.length === 0 ? (
              <p className="muted">Nothing yet.</p>
            ) : (
              <ul className="activity">
                {activity.map(({ event, text }) => (
                  <li key={event.id}>
                    <span>{text}</span>
                    <RelativeTime value={event.createdAt} />
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
