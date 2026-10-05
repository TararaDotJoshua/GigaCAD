import { diffManifests } from '@gigacad/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChangeList, changeSummary } from '../../../../../../components/product/ChangeList';
import { PageHead } from '../../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { StatusBadge } from '../../../../../../components/product/StatusBadge';
import type { Commit } from '../../../../../../lib/api';
import { branchPath, commitPath, projectPath } from '../../../../../../lib/paths';
import { getBranchDetail, getCommit, getCommits, getProject } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

/** A commit's heading: its message, or its label, or what kind it is. */
const commitTitle = (commit: Commit) => commit.message || commit.versionLabel || (commit.kind === 'autosave' ? 'Autosave' : 'Version');

export async function generateMetadata({ params }: { params: Promise<ProjectParams & { id: string }> }) {
  const { owner, project, id } = await params;
  // A missing commit 404s from the page itself. Throwing here would stream the error after a 200.
  const detail = await getCommit(id).catch(() => null);
  return { title: `${detail ? commitTitle(detail.commit) : 'Commit'} · ${owner}/${project}` };
}

export default async function CommitPage({ params }: { params: Promise<ProjectParams & { id: string }> }) {
  const { owner, project: slug, id } = await params;
  const project = await getProject(owner, slug);
  const detail = await getCommit(id);
  const [branch, siblings] = await Promise.all([getBranchDetail(detail.commit.branchId), getCommits(detail.commit.branchId)]);
  if (branch.branch.projectId !== project.id) notFound();
  const parent = detail.commit.parentId ? await getCommit(detail.commit.parentId) : null;
  const child = siblings.find((commit) => commit.parentId === id) ?? null;
  const changes = diffManifests(parent?.files ?? [], detail.files);
  const { commit } = detail;
  const kind = commit.kind === 'autosave' ? 'Autosave' : 'Version';

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
        title={commitTitle(commit)}
        meta={
          <>
            <StatusBadge tone="quiet">{commit.versionLabel ? `${kind} ${commit.versionLabel}` : kind}</StatusBadge>
            <span>
              @{commit.authorHandle || 'unknown'} · <RelativeTime value={commit.createdAt} />
            </span>
            <span className="mono muted" title={id}>
              {id.slice(0, 8)}
            </span>
          </>
        }
      />
      <nav className="commit-nav" aria-label="Versions">
        {parent ? <Link href={commitPath(owner, slug, parent.commit.id)}>← Previous: {commitTitle(parent.commit)}</Link> : <span className="muted">First on this branch</span>}
        <Link href={branchPath(owner, slug, branch.branch.name)}>All of {branch.branch.name}</Link>
        {child ? <Link href={commitPath(owner, slug, child.id)}>Next: {commitTitle(child)} →</Link> : <span className="muted">Latest on this branch</span>}
      </nav>
      <section className="section">
        <h2>Changes</h2>
        {changes.length > 0 && <p className="change-summary">{changeSummary(changes)}</p>}
        <ChangeList projectId={project.id} changes={changes} empty="No file changes in this snapshot." />
      </section>
    </div>
  );
}
