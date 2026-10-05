import { diffManifests } from '@gigacad/core';
import Link from 'next/link';
import { ChangeList, changeSummary } from '../../../../../../components/product/ChangeList';
import { PageHead } from '../../../../../../components/product/PageHead';
import { ProjectDirectory } from '../../../../../../components/product/ProjectDirectory';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { DownloadIcon, LockIcon } from '../../../../../../components/icons';
import { projectPath, releaseDownloadPath, releasePath, releaseRequestPath } from '../../../../../../lib/paths';
import { getProject, getRelease, getViewer, parseNumber } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

type ReleaseParams = ProjectParams & { number: string };

export async function generateMetadata({ params }: { params: Promise<ReleaseParams> }) {
  const { owner, project: slug, number } = await params;
  // A missing release 404s from the page itself. Throwing here would stream the error after a 200.
  const release = await getProject(owner, slug)
    .then((project) => getRelease(project.id, parseNumber(number)))
    .then((detail) => detail.release)
    .catch(() => null);
  return { title: `${release?.title ? `v${release.number}: ${release.title}` : `v${number}`} · ${owner}/${slug}` };
}

/** A release: what it's called, what changed since the one before, and all its files, locked. */
export default async function ReleasePage({ params }: { params: Promise<ReleaseParams> }) {
  const { owner, project: slug, number } = await params;
  const project = await getProject(owner, slug);
  const [{ release, files }, viewer] = await Promise.all([getRelease(project.id, parseNumber(number)), getViewer()]);
  const previous = release.number > 1 ? await getRelease(project.id, release.number - 1) : null;
  const changes = diffManifests(previous?.files ?? [], files);
  return (
    <div className="page">
      <PageHead
        crumbs={[{ label: owner, href: `/${owner}` }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Releases', href: projectPath(owner, slug, 'releases') }, { label: `v${release.number}` }]}
        title={
          <>
            <span className="mono">v{release.number}</span>
            {release.title && <span className="release-title">{release.title}</span>}
          </>
        }
        meta={
          <>
            <span className="locked">
              <LockIcon className="icon" /> Permanently locked
            </span>
            <span>
              Released <RelativeTime value={release.createdAt} />
              {release.createdByHandle && ` by @${release.createdByHandle}`}
            </span>
            {release.releaseRequestNumber && <Link href={releaseRequestPath(owner, slug, release.releaseRequestNumber)}>Release request #{release.releaseRequestNumber}</Link>}
          </>
        }
        actions={
          <a className="btn btn-primary" href={releaseDownloadPath(owner, slug, release.number)} download>
            <DownloadIcon className="icon" />
            Download all ({files.length} {files.length === 1 ? 'file' : 'files'})
          </a>
        }
      />
      {release.notes && <p className="notes release-notes">{release.notes}</p>}
      <div className="stack">
        <section className="section">
          <h2>{previous ? `Changes from v${previous.release.number}` : 'First release'}</h2>
          {previous ? (
            <>
              {changes.length > 0 && <p className="change-summary">{changeSummary(changes)}</p>}
              <ChangeList projectId={project.id} changes={changes} empty={`Same files as v${previous.release.number}.`} />
            </>
          ) : (
            <p className="muted">Everything below is new in v1.</p>
          )}
          {previous && (
            <p className="toolbar-note">
              <Link href={releasePath(owner, slug, previous.release.number)}>← v{previous.release.number}</Link>
            </p>
          )}
        </section>
        <section className="section">
          <h2>Files</h2>
          <ProjectDirectory project={project} path={`Releases/v${release.number}`} params={{}} signedIn={!!viewer} viewerHandle={viewer?.handle ?? null} embedded />
        </section>
      </div>
    </div>
  );
}
