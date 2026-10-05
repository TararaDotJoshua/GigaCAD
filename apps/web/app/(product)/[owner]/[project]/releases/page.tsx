import Link from 'next/link';
import { EmptyState } from '../../../../../components/product/EmptyState';
import { PageHead } from '../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../components/product/RelativeTime';
import { StatusBadge } from '../../../../../components/product/StatusBadge';
import { projectPath, releaseDownloadPath, releasePath } from '../../../../../lib/paths';
import { getProject, getReleases } from '../../../../../lib/product';
import type { ProjectParams } from '../layout';

export const metadata = { title: 'Releases' };

export default async function Releases({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project: slug } = await params;
  const project = await getProject(owner, slug);
  const releases = await getReleases(project.id);
  return (
    <div className="page">
      <PageHead
        crumbs={[{ label: owner, href: `/${owner}` }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Releases' }]}
        title="Releases"
        meta={<span>Each release is a permanent, locked snapshot of main.</span>}
      />
      {releases.length === 0 ? (
        <EmptyState title="No releases yet.">
          <p>Open a release request from a branch to make v1.</p>
          <Link className="btn btn-secondary" href={projectPath(owner, slug, 'branches')}>
            Go to branches
          </Link>
        </EmptyState>
      ) : (
        <ol className="timeline">
          {releases.map((release, index) => (
            <li key={release.id} className="timeline-item">
              <span className="timeline-node" aria-hidden="true" />
              <div className="timeline-body">
                <Link href={releasePath(owner, slug, release.number)} className="timeline-title">
                  <span className="mono">v{release.number}</span>
                  {release.title && <> · {release.title}</>}
                </Link>
                <p className="timeline-meta">
                  {index === 0 && <StatusBadge tone="signal">Latest</StatusBadge>} Released <RelativeTime value={release.createdAt} />
                  {release.createdByHandle && ` by @${release.createdByHandle}`} · <a href={releaseDownloadPath(owner, slug, release.number)} download>Download</a>
                </p>
                {release.notes && <p className="timeline-text release-notes">{release.notes}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
