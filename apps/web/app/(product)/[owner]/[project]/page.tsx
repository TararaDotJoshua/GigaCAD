import Link from 'next/link';
import { EmptyState } from '../../../../components/product/EmptyState';
import { FileTable } from '../../../../components/product/FileTable';
import { PageHead } from '../../../../components/product/PageHead';
import { RelativeTime } from '../../../../components/product/RelativeTime';
import { StatusBadge } from '../../../../components/product/StatusBadge';
import { ForkIcon, LockIcon } from '../../../../components/icons';
import { StarButton } from '../../../../components/product/StarButton';
import { describeEvent } from '../../../../lib/describe';
import { projectPath, releasePath } from '../../../../lib/paths';
import { getBranches, getEvents, getMembers, getProject, getRelease, getReleases, getViewer, parseNumber } from '../../../../lib/product';
import type { ProjectParams } from './layout';

export async function generateMetadata({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project } = await params;
  return { title: `${owner}/${project}` };
}

export default async function ProjectFiles({ params, searchParams }: { params: Promise<ProjectParams>; searchParams: Promise<{ release?: string }> }) {
  const { owner, project: slug } = await params;
  const project = await getProject(owner, slug);
  const [releases, events, members, branches, query, viewer] = await Promise.all([
    getReleases(project.id),
    getEvents(project.id),
    getMembers(project.id),
    getBranches(project.id),
    searchParams,
    getViewer(),
  ]);
  const number = query.release ? parseNumber(query.release) : releases[0]?.number;
  const release = number ? await getRelease(project.id, number) : undefined;
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
        crumbs={[{ label: project.ownerHandle }, { label: project.name }]}
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
          {release ? (
            <>
              <div className="toolbar">
                <details className="menu">
                  <summary className="btn btn-secondary btn-small">
                    <LockIcon className="icon" />
                    <span className="mono">v{release.release.number}</span>
                    {release.release.number === releases[0]?.number && <span className="muted">latest</span>}
                  </summary>
                  <ul className="menu-list">
                    {releases.map((r) => (
                      <li key={r.id}>
                        <Link href={`${projectPath(owner, slug)}?release=${r.number}`} aria-current={r.number === release.release.number ? 'true' : undefined}>
                          <span className="mono">v{r.number}</span>
                          <span className="muted">
                            <RelativeTime value={r.createdAt} />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
                <p className="toolbar-note">
                  {release.files.length} {release.files.length === 1 ? 'file' : 'files'}, released <RelativeTime value={release.release.createdAt} />
                  {release.release.createdByHandle && ` by @${release.release.createdByHandle}`}.{' '}
                  <Link href={releasePath(owner, slug, release.release.number)}>Release notes</Link>
                </p>
              </div>
              {release.files.length > 0 ? (
                <FileTable projectId={project.id} files={release.files} />
              ) : (
                <EmptyState title={`v${release.release.number} has no files.`} />
              )}
            </>
          ) : (
            <EmptyState title="No releases yet.">
              <p>
                Main fills up when you release a branch. Create a branch, add files from the GigaCAD drive or with <code className="mono">giga commit</code>,
                then open a release request.
              </p>
              <Link href={projectPath(owner, slug, 'branches')} className="btn btn-secondary">
                Go to branches
              </Link>
            </EmptyState>
          )}
        </section>

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
  );
}
