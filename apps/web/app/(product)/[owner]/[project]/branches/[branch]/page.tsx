import { diffManifests } from '@gigacad/core';
import Link from 'next/link';
import { archiveBranch, forceReleaseLock, openReleaseRequest } from '../../../../actions';
import { ActionButton } from '../../../../../../components/product/ActionButton';
import { ActionForm } from '../../../../../../components/product/ActionForm';
import { ChangeList, changeSummary } from '../../../../../../components/product/ChangeList';
import { CopyCommand } from '../../../../../../components/product/CopyCommand';
import { EmptyState } from '../../../../../../components/product/EmptyState';
import { PageHead } from '../../../../../../components/product/PageHead';
import { ProjectDirectory } from '../../../../../../components/product/ProjectDirectory';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { StatusBadge } from '../../../../../../components/product/StatusBadge';
import { sites } from '../../../../../../lib/hosts';
import { BRANCH_STATUS_LABEL, branchTone, groupTimeline } from '../../../../../../lib/describe';
import { commitPath, projectPath, releasePath, releaseRequestPath } from '../../../../../../lib/paths';
import { getBranchByName, getBranchDetail, getCommits, getProject, getRelease, getReleaseRequests, getViewer } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

export async function generateMetadata({ params }: { params: Promise<ProjectParams & { branch: string }> }) {
  const { owner, project, branch: name } = await params;
  // Looked up, so a missing branch (or one in a project you can't see) never echoes its name.
  const branch = await getProject(owner, project)
    .then((found) => getBranchByName(found.id, name))
    .catch(() => null);
  if (!branch) return { title: 'Not found' };
  return { title: `${branch.name} · ${owner}/${project}` };
}

export default async function BranchPage({ params }: { params: Promise<ProjectParams & { branch: string }> }) {
  const { owner, project: slug, branch: name } = await params;
  const project = await getProject(owner, slug);
  const branch = await getBranchByName(project.id, name);
  const [detail, commits, requests, viewer] = await Promise.all([getBranchDetail(branch.id), getCommits(branch.id), getReleaseRequests(project.id), getViewer()]);
  const base = branch.baseReleaseNumber ? await getRelease(project.id, branch.baseReleaseNumber) : null;
  const changes = diffManifests(base?.files ?? [], detail.files);
  const request = requests.find((candidate) => candidate.branchName === branch.name && (candidate.status === 'open' || candidate.status === 'candidate'));
  const canManage = project.role === 'owner' || project.role === 'maintainer';
  const canWrite = canManage || project.role === 'contributor';
  const timeline = groupTimeline(commits);
  const { siteUrl } = sites();
  // A branch nobody has worked on yet gets one next step instead of three empty sections.
  const fresh = canWrite && branch.status === 'open' && changes.length === 0 && !commits.some((commit) => commit.kind === 'version');

  return (
    <div className="page">
      <PageHead
        crumbs={[{ label: owner, href: `/${owner}` }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Branches', href: projectPath(owner, slug, 'branches') }, { label: branch.name }]}
        title={<span className="mono">{branch.name}</span>}
        meta={
          <>
            <StatusBadge tone={branchTone(branch.status)}>{BRANCH_STATUS_LABEL[branch.status]}</StatusBadge>
            {request && (
              <Link href={releaseRequestPath(owner, slug, request.number)}>
                {branch.status === 'frozen' ? 'Frozen for release request' : 'Release request'} #{request.number}: {request.title}
              </Link>
            )}
            <span>
              From {branch.baseReleaseNumber ? <Link href={releasePath(owner, slug, branch.baseReleaseNumber)}>v{branch.baseReleaseNumber}</Link> : 'an empty project'}
            </span>
          </>
        }
      />
      <div className="page-grid">
        <div className="stack">
          {fresh && (
            <section className="section card start-branch">
              <h2>
                Start working on <span className="mono">{branch.name}</span>
              </h2>
              <p className="section-intro">
                Download the branch with the <code className="mono">giga</code> CLI and check it out, so only you can save to it. Commit versions as you go, then open a release request here.
              </p>
              <CopyCommand command={`giga clone ${owner}/${slug} --branch ${branch.name} ${branch.name}\ncd ${branch.name}\ngiga checkout`} />
              <a className="muted" href={`${siteUrl}/docs/cli#a-typical-session`}>
                A typical session with the CLI
              </a>
            </section>
          )}
          {!fresh && (
            <>
              <section className="section">
                <h2>{branch.baseReleaseNumber ? `Changes from v${branch.baseReleaseNumber}` : 'Changes'}</h2>
                {changes.length > 0 && <p className="change-summary">{changeSummary(changes)}</p>}
                <ChangeList projectId={project.id} changes={changes} empty={branch.baseReleaseNumber ? `Nothing has changed since v${branch.baseReleaseNumber}.` : 'No files yet.'} />
              </section>
              <section className="section">
                <h2>Files</h2>
                <ProjectDirectory project={project} path={`Branches/${branch.name}`} params={{}} signedIn={!!viewer} viewerHandle={viewer?.handle ?? null} embedded />
              </section>
              <section className="section">
                <h2>Version history</h2>
                {timeline.length ? (
                  <ol className="timeline">
                    {timeline.map((entry, index) => (
                      <li key={entry.kind === 'version' ? entry.commit.id : `autosaves-${index}`} className="timeline-item">
                        <span className="timeline-node" />
                        <div className="timeline-body">
                          {entry.kind === 'version' ? (
                            <>
                              <Link className="timeline-title" href={commitPath(owner, slug, entry.commit.id)}>
                                {entry.commit.message || entry.commit.versionLabel || 'Version'}
                              </Link>
                              <p className="timeline-meta">
                                <StatusBadge tone="quiet">{entry.commit.versionLabel || 'Version'}</StatusBadge> @{entry.commit.authorHandle || 'unknown'} · <RelativeTime value={entry.commit.createdAt} />
                              </p>
                            </>
                          ) : (
                            <details>
                              <summary>
                                Unsaved work · {entry.commits.length} autosave{entry.commits.length === 1 ? '' : 's'}
                              </summary>
                              <ul>
                                {entry.commits.map((commit) => (
                                  <li key={commit.id}>
                                    <Link href={commitPath(owner, slug, commit.id)}>
                                      <RelativeTime value={commit.createdAt} />
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <EmptyState title="No versions yet." />
                )}
              </section>
            </>
          )}
        </div>
        <aside className="request-rail">
          <section className="rail-card">
            <h2>Checked out</h2>
            {branch.checkedOutByHandle ? (
              <p>
                Checked out by <strong>@{branch.checkedOutByHandle}</strong>
                {branch.checkedOutMachine && ` on ${branch.checkedOutMachine}`}
                {branch.checkedOutAt && (
                  <>
                    {' '}
                    <RelativeTime value={branch.checkedOutAt} />
                  </>
                )}
                . Only they can save to it until they check it in.
              </p>
            ) : (
              <p>No one has this branch checked out.</p>
            )}
            <p className="muted">
              Check out a branch with <code className="mono">giga checkout</code>. <a href={`${siteUrl}/docs/cli#a-typical-session`}>How checking out works</a>
            </p>
            {canManage && branch.checkedOutBy && (
              <>
                <p className="muted">If they’ve gone quiet, you can take the lock back. Their unsaved autosaves stay on the branch.</p>
                <ActionButton action={forceReleaseLock.bind(null, branch.id)} className="btn btn-danger btn-small" confirm={`Force-release @${branch.checkedOutByHandle}’s lock on ${branch.name}? They’ll need to check it out again to keep saving.`}>
                  Force-release lock
                </ActionButton>
              </>
            )}
          </section>
          {canWrite && branch.status === 'open' && (
            <section className="rail-card">
              <h2>Open release request</h2>
              <p className="muted">This checks the branch in and freezes it: nobody can save to it until the request is released or closed. You can close the request any time to unfreeze it.</p>
              <ActionForm action={openReleaseRequest.bind(null, branch.id, owner, slug)} submitLabel="Open release request" pendingLabel="Opening…">
                <label className="field">
                  <span>Title</span>
                  <input name="title" required maxLength={200} placeholder="What this release changes" />
                </label>
                <label className="field">
                  <span>
                    Description <em>optional</em>
                  </span>
                  <textarea name="body" rows={3} />
                </label>
              </ActionForm>
            </section>
          )}
          {canManage && branch.status === 'open' && (
            <section className="rail-card">
              <h2>Archive branch</h2>
              <p className="muted">Archived branches are read-only and hidden from the branch list. Their history stays.</p>
              <ActionButton action={archiveBranch.bind(null, branch.id)} className="btn btn-danger btn-small" confirm={`Archive ${branch.name}? It becomes read-only.`}>
                Archive
              </ActionButton>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
