import { diffManifests } from '@gigacad/core';
import Link from 'next/link';
import { ChangeList, changeSummary } from '../../../../../../components/product/ChangeList';
import { MarkdownText } from '../../../../../../components/product/MarkdownText';
import { PageHead } from '../../../../../../components/product/PageHead';
import { ProjectDirectory, type DirectoryParams } from '../../../../../../components/product/ProjectDirectory';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { DownloadIcon, LockIcon } from '../../../../../../components/icons';
import { projectPath, releaseDownloadPath, releasePath, releaseRequestPath } from '../../../../../../lib/paths';
import { getFileExports, getProject, getRelease, getReleases, getViewer, parseNumber } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

type ReleaseParams = ProjectParams & { number: string };

export async function generateMetadata({ params }: { params: Promise<ReleaseParams> }) {
  const { owner, project: slug, number } = await params;
  // A missing release 404s from the page itself. Throwing here would stream the error after a 200.
  const release = await getProject(owner, slug)
    .then((project) => getRelease(project.id, parseNumber(number)))
    .then((detail) => detail.release)
    .catch(() => null);
  if (!release) return { title: 'Not found' };
  return { title: `${release.title ? `v${release.number}: ${release.title}` : `v${release.number}`} · ${owner}/${slug}` };
}

/** A release: what it's called, what changed since the one before, and all its files, locked. */
export default async function ReleasePage({ params, searchParams }: { params: Promise<ReleaseParams>; searchParams: Promise<DirectoryParams & { download?: string }> }) {
  const [{ owner, project: slug, number }, { sort, order, offset, download }] = await Promise.all([params, searchParams]);
  const project = await getProject(owner, slug);
  const [{ release, files }, viewer, releases] = await Promise.all([getRelease(project.id, parseNumber(number)), getViewer(), getReleases(project.id)]);
  // The exports this release was made with, which never change.
  const exportable = files.filter((file) => /\.(sldprt|sldasm)$/i.test(file.path)).map((file) => file.blob);
  const exported = getFileExports(project.id, exportable, release.number);
  const previous = release.number > 1 ? await getRelease(project.id, release.number - 1) : null;
  const newer = releases.some((other) => other.number === release.number + 1) ? release.number + 1 : null;
  const changes = diffManifests(previous?.files ?? [], files);
  // The lookup takes 1000 files at a time; a release with more offers its exports either way.
  const hasExports = exportable.length > 1000 || Object.keys(await exported).length > 0;
  return (
    <div className="page">
      <PageHead
        crumbs={[{ label: owner, href: `/${owner}` }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Releases', href: projectPath(owner, slug, 'releases') }, { label: `v${release.number}` }]}
        title={
          <>
            <span className="mono">v{release.number}</span>
            {release.title && <span className="release-title">: {release.title}</span>}
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
          <>
            {hasExports && (
              <a className="btn btn-secondary" href={`${releaseDownloadPath(owner, slug, release.number)}?exports=1`}>
                Download all with STEP and STL exports
              </a>
            )}
            <a className="btn btn-primary" href={releaseDownloadPath(owner, slug, release.number)}>
              <DownloadIcon className="icon" />
              Download all ({files.length} {files.length === 1 ? 'file' : 'files'})
            </a>
          </>
        }
      />
      {download === 'failed' && (
        <p className="notice" role="alert">
          This release couldn’t be downloaded. Try again in a moment.
        </p>
      )}
      {release.notes && <MarkdownText className="notes release-notes">{release.notes}</MarkdownText>}
      <div className="stack">
        <section className="section">
          <h2>{previous ? `Changes from v${previous.release.number}` : 'First release'}</h2>
          {previous ? (
            <>
              {changes.length > 0 && <p className="change-summary">{changeSummary(changes)}</p>}
              <ChangeList projectId={project.id} changes={changes} empty={`Same files as v${previous.release.number}.`} releaseNumber={release.number} />
            </>
          ) : (
            <p className="muted">Everything below is new in v1.</p>
          )}
          {(previous || newer) && (
            <p className="toolbar-note release-nav">
              {previous && <Link href={releasePath(owner, slug, previous.release.number)}>← v{previous.release.number}</Link>}
              {newer && <Link href={releasePath(owner, slug, newer)}>v{newer} →</Link>}
            </p>
          )}
        </section>
        <section className="section">
          <h2>Files</h2>
          <ProjectDirectory
            project={project}
            path={`Releases/v${release.number}`}
            params={{ sort, order, offset }}
            signedIn={!!viewer}
            viewerHandle={viewer?.handle ?? null}
            embedded
            basePath={releasePath(owner, slug, release.number)}
          />
        </section>
      </div>
    </div>
  );
}
