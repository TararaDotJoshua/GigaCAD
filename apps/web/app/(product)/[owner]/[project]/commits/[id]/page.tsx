import { diffManifests } from '@gigacad/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChangeList, changeSummary } from '../../../../../../components/product/ChangeList';
import { PageHead } from '../../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { StatusBadge } from '../../../../../../components/product/StatusBadge';
import type { Commit } from '../../../../../../lib/api';
import { releaseName } from '../../../../../../lib/describe';
import { branchPath, commitPath, projectPath, releasePath } from '../../../../../../lib/paths';
import { getBranchDetail, getCommit, getCommits, getProject, getRelease } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

/** A commit's heading: its message, or its label, or what kind it is. */
const commitTitle = (commit: Commit) => commit.message || commit.versionLabel || (commit.kind === 'autosave' ? 'Autosave' : 'Version');

export async function generateMetadata({ params }: { params: Promise<ProjectParams & { id: string }> }) {
  const { owner, project, id } = await params;
  // A missing commit 404s from the page itself. Throwing here would stream the error after a 200.
  // The commit must belong to this project, or the title would name another project's work.
  const detail = await Promise.all([getProject(owner, project), getCommit(id)])
    .then(async ([found, commit]) => ((await getBranchDetail(commit.commit.branchId)).branch.projectId === found.id ? commit : null))
    .catch(() => null);
  if (!detail) return { title: 'Not found' };
  return { title: `${commitTitle(detail.commit)} · ${owner}/${project}` };
}

export default async function CommitPage({ params }: { params: Promise<ProjectParams & { id: string }> }) {
  const { owner, project: slug, id } = await params;
  const project = await getProject(owner, slug);
  const detail = await getCommit(id);
  const [branch, siblings] = await Promise.all([getBranchDetail(detail.commit.branchId), getCommits(detail.commit.branchId)]);
  if (branch.branch.projectId !== project.id) notFound();
  const parent = detail.commit.parentId ? await getCommit(detail.commit.parentId) : null;
  // A branch's first commit copies the release it started from, so compare it with that release.
  const base = !parent && branch.branch.baseReleaseNumber ? await getRelease(project.id, branch.branch.baseReleaseNumber) : null;
  const child = siblings.find((commit) => commit.parentId === id) ?? null;
  const changes = diffManifests(parent?.files ?? base?.files ?? [], detail.files);
  const { commit } = detail;
  const kind = commit.kind === 'autosave' ? 'Autosave' : 'Version';
  const title = commitTitle(commit);
  const badge = commit.versionLabel ? `${kind} ${commit.versionLabel}` : kind;

  return (
    <div className="page">
      <PageHead
        crumbs={[
          { label: owner, href: `/${owner}` },
          { label: project.name, href: projectPath(owner, slug) },
          { label: 'Branches', href: projectPath(owner, slug, 'branches') },
          { label: branch.branch.name, href: branchPath(owner, slug, branch.branch.name) },
          { label: commit.versionLabel || kind },
        ]}
        title={title}
        meta={
          <>
            {/* The badge says what kind of snapshot it is, unless the heading already does. */}
            {badge !== title && commit.versionLabel !== title && <StatusBadge tone="quiet">{badge}</StatusBadge>}
            <span>
              @{commit.authorHandle || 'unknown'} · <RelativeTime value={commit.createdAt} />
            </span>
            <span className="mono muted" title={id}>
              {id.slice(0, 8)}
            </span>
          </>
        }
      />
      {commit.kind === 'autosave' && (
        <p className="notice" role="status">
          Autosaves are temporary. This one is cleared when the next version on {branch.branch.name} is committed, so this link stops working then.
        </p>
      )}
      <nav className="commit-nav" aria-label="Versions">
        {parent ? (
          <Link href={commitPath(owner, slug, parent.commit.id)}>← Previous: {commitTitle(parent.commit)}</Link>
        ) : base ? (
          <Link href={releasePath(owner, slug, base.release.number)}>← {releaseName(base.release)}</Link>
        ) : (
          <span className="muted">First on this branch</span>
        )}
        <Link href={branchPath(owner, slug, branch.branch.name)}>All of {branch.branch.name}</Link>
        {child ? <Link href={commitPath(owner, slug, child.id)}>Next: {commitTitle(child)} →</Link> : <span className="muted">Latest on this branch</span>}
      </nav>
      <section className="section">
        <h2>Changes</h2>
        {changes.length > 0 && <p className="change-summary">{changeSummary(changes)}</p>}
        <ChangeList
          projectId={project.id}
          changes={changes}
          empty={base ? `Same as v${base.release.number}: the branch started here.` : 'No file changes in this snapshot.'}
        />
      </section>
    </div>
  );
}
