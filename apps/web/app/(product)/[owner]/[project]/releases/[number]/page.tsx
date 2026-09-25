import Link from 'next/link';
import { EmptyState } from '../../../../../../components/product/EmptyState';
import { FileTable } from '../../../../../../components/product/FileTable';
import { PageHead } from '../../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { LockIcon } from '../../../../../../components/icons';
import { projectPath, releaseRequestPath } from '../../../../../../lib/paths';
import { getProject, getRelease, getReleaseRequests, parseNumber } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

export async function generateMetadata({ params }: { params: Promise<ProjectParams & { number: string }> }) {
  const { number } = await params;
  return { title: `v${number}` };
}

export default async function ReleasePage({ params }: { params: Promise<ProjectParams & { number: string }> }) {
  const { owner, project: slug, number } = await params;
  const project = await getProject(owner, slug);
  const [{ release, files }, requests] = await Promise.all([getRelease(project.id, parseNumber(number)), getReleaseRequests(project.id)]);
  const request = requests.find((candidate) => candidate.id === release.releaseRequestId);
  return (
    <div className="page">
      <PageHead
        crumbs={[
          { label: project.ownerHandle },
          { label: project.name, href: projectPath(owner, slug) },
          { label: 'Releases', href: projectPath(owner, slug, 'releases') },
          { label: `v${release.number}` },
        ]}
        title={<span className="mono">v{release.number}</span>}
        meta={
          <>
            <span className="locked">
              <LockIcon className="icon" /> Permanently locked
            </span>
            <span>
              Released <RelativeTime value={release.createdAt} />
              {release.createdByHandle && ` by @${release.createdByHandle}`}
            </span>
            {request && (
              <Link href={releaseRequestPath(owner, slug, request.number)}>
                from release request #{request.number}
              </Link>
            )}
          </>
        }
      />
      {release.notes && <p className="notes">{release.notes}</p>}
      {files.length > 0 ? <FileTable projectId={project.id} files={files} /> : <EmptyState title="This release has no files." />}
    </div>
  );
}
