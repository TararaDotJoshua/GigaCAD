import Link from 'next/link';
import { EmptyState } from '../../../../../components/product/EmptyState';
import { PageHead } from '../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../components/product/RelativeTime';
import { projectPath, releasePath } from '../../../../../lib/paths';
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
        crumbs={[{ label: project.ownerHandle }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Releases' }]}
        title="Releases"
        meta={<span>Each release is a permanent, locked snapshot of main.</span>}
      />
      {releases.length === 0 ? (
        <EmptyState title="No releases yet.">
          <p>Open a release request from a branch to make v1.</p>
        </EmptyState>
      ) : (
        <ol className="timeline">
          {releases.map((release) => (
            <li key={release.id} className="timeline-item">
              <span className="timeline-node" aria-hidden="true" />
              <div className="timeline-body">
                <Link href={releasePath(owner, slug, release.number)} className="timeline-title">
                  <span className="mono">v{release.number}</span>
                </Link>
                <p className="timeline-meta">
                  Released <RelativeTime value={release.createdAt} />
                  {release.createdByHandle && ` by @${release.createdByHandle}`}
                </p>
                {release.notes && <p className="timeline-text">{release.notes.split('\n')[0]}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
