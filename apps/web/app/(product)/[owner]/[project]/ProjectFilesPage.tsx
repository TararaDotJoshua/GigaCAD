import Link from 'next/link';
import { DownloadIcon, ForkIcon, LockIcon } from '../../../../components/icons';
import { FileGlyph } from '../../../../components/product/FileGlyph';
import { PageHead } from '../../../../components/product/PageHead';
import { ProjectDirectory, TagsCard, type DirectoryParams } from '../../../../components/product/ProjectDirectory';
import { RelativeTime } from '../../../../components/product/RelativeTime';
import { StarButton } from '../../../../components/product/StarButton';
import { StatusBadge } from '../../../../components/product/StatusBadge';
import type { Project, Release } from '../../../../lib/api';
import { collapseActivity, describeEvent, releaseName } from '../../../../lib/describe';
import { projectPath, releaseDownloadPath, releasePath, treePath } from '../../../../lib/paths';
import { getBranches, getEvents, getMembers, getProject, getRelease, getReleases, getTags, getViewer } from '../../../../lib/product';

/** How much of the feed the project page shows; the rest is on the activity page. */
const ACTIVITY_SHOWN = 5;
/** How many of the latest release's files the project page lists. */
const RELEASE_FILES_SHOWN = 8;

/**
 * The project page and its folders. At the root: the latest release, then the project's
 * files, with tags and recent activity beside them. In a folder: just the folder.
 */
export async function ProjectFilesPage({ owner, slug, path, params }: { owner: string; slug: string; path: string; params: DirectoryParams }) {
  const project = await getProject(owner, slug);
  const isRoot = path === '';
  const searching = Boolean(params.q || params.tags || params.view);
  const [branches, releases, viewer] = await Promise.all([getBranches(project.id), getReleases(project.id), getViewer()]);
  const latest = releases.reduce<Release | null>((best, release) => (!best || release.number > best.number ? release : best), null);
  const openBranches = branches.filter((branch) => branch.status === 'open' || branch.status === 'frozen').length;

  return (
    <div className="page">
      <PageHead
        crumbs={[{ label: project.ownerHandle, href: `/${project.ownerHandle}` }, { label: project.name, href: isRoot ? undefined : projectPath(owner, slug) }]}
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
            {/* Starring your own private project only ever counts you. */}
            {(project.visibility === 'public' || project.starred) && (
              <StarButton projectId={project.id} starred={project.starred} count={project.starCount} signedIn={!!viewer} next={projectPath(owner, slug)} />
            )}
            {latest ? (
              <Link href={projectPath(owner, slug, 'fork')} className="btn btn-secondary" title={project.forkCount ? `${project.forkCount} public ${project.forkCount === 1 ? 'fork' : 'forks'}` : undefined}>
                <ForkIcon className="icon" />
                Fork{project.forkCount ? ` ${project.forkCount}` : ''}
              </Link>
            ) : (
              project.visibility === 'public' && (
                <button type="button" className="btn btn-secondary" disabled title="Forks start from a release. This project has none yet.">
                  <ForkIcon className="icon" />
                  Fork
                </button>
              )
            )}
          </>
        }
      />
      {isRoot ? (
        <div className="page-grid">
          <div className="stack">
            {latest && !searching && <LatestRelease project={project} release={latest} />}
            <section aria-label="Files">
              <ProjectDirectory project={project} path={path} params={params} signedIn={!!viewer} viewerHandle={viewer?.handle ?? null} counts={{ branches: openBranches, releases: releases.length }} />
            </section>
          </div>
          <ProjectRail project={project} />
        </div>
      ) : (
        <section aria-label="Files">
          <ProjectDirectory project={project} path={path} params={params} signedIn={!!viewer} viewerHandle={viewer?.handle ?? null} />
        </section>
      )}
    </div>
  );
}

/** The newest release, named after its request, with its first files and a download for all of them. */
async function LatestRelease({ project, release }: { project: Project; release: Release }) {
  const owner = project.ownerHandle;
  const slug = project.slug;
  const { files } = await getRelease(project.id, release.number);
  const shown = [...files].sort((a, b) => a.path.localeCompare(b.path)).slice(0, RELEASE_FILES_SHOWN);
  return (
    <section className="latest-release-section" aria-labelledby="latest-release-heading">
      <div className="latest-release-head">
        <div>
          <p className="latest-release-kicker">
            <LockIcon className="icon" /> Latest release
          </p>
          <h2 id="latest-release-heading">
            <Link href={releasePath(owner, slug, release.number)}>{releaseName(release)}</Link>
          </h2>
          <p className="muted">
            Released <RelativeTime value={release.createdAt} />
            {release.createdByHandle && ` by @${release.createdByHandle}`} · {files.length} {files.length === 1 ? 'file' : 'files'}
          </p>
        </div>
        <div className="latest-release-actions">
          <a className="btn btn-primary btn-small" href={releaseDownloadPath(owner, slug, release.number)} download>
            <DownloadIcon className="icon" />
            Download all
          </a>
          <Link className="btn btn-secondary btn-small" href={treePath(owner, slug, `Releases/v${release.number}`)}>
            Browse files
          </Link>
        </div>
      </div>
      <ul className="latest-release-files">
        {shown.map((file) => (
          <li key={file.itemId}>
            <FileGlyph path={file.path} />
            <span className="mono">{file.path}</span>
          </li>
        ))}
      </ul>
      {files.length > shown.length && (
        <Link className="latest-release-more" href={treePath(owner, slug, `Releases/v${release.number}`)}>
          All {files.length} files in v{release.number}
        </Link>
      )}
    </section>
  );
}

/** Tags and a short activity feed, beside the root's files. */
async function ProjectRail({ project }: { project: Project }) {
  const [events, members, branches, tags] = await Promise.all([getEvents(project.id, 40), getMembers(project.id), getBranches(project.id), getTags(project.id)]);
  const handles = new Map(members.map((member) => [member.userId, member.handle]));
  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
  const names = {
    handle: (id: string | null) => (id && handles.has(id) ? `@${handles.get(id)}` : 'Someone'),
    branch: (id: string | null) => (id ? branchNames.get(id) : undefined),
  };
  const activity = collapseActivity(
    events.map((event) => ({ event, text: describeEvent(event, names) ?? '' })).filter((entry) => entry.text),
    names,
  );
  return (
    <div className="side-stack">
      <TagsCard project={project} tags={tags} />
      <aside className="side" aria-label="Recent activity">
        <h2 className="side-heading">Activity</h2>
        {activity.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <>
            <ul className="activity">
              {activity.slice(0, ACTIVITY_SHOWN).map(({ event, text }) => (
                <li key={event.id}>
                  <span>{text}</span>
                  <RelativeTime value={event.createdAt} />
                </li>
              ))}
            </ul>
            {activity.length > ACTIVITY_SHOWN && (
              <Link className="releases-more" href={projectPath(project.ownerHandle, project.slug, 'activity')}>
                All activity
              </Link>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
