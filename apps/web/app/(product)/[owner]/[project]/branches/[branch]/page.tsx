import { diffManifests } from '@gigacad/core';
import Link from 'next/link';
import { archiveBranch, checkInBranch, forceReleaseLock, openReleaseRequest, unarchiveBranch } from '../../../../actions';
import { ActionButton } from '../../../../../../components/product/ActionButton';
import { ActionForm } from '../../../../../../components/product/ActionForm';
import { ChangeList, changeSummary } from '../../../../../../components/product/ChangeList';
import { EmptyState } from '../../../../../../components/product/EmptyState';
import { PageHead } from '../../../../../../components/product/PageHead';
import { ProjectDirectory } from '../../../../../../components/product/ProjectDirectory';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { StatusBadge } from '../../../../../../components/product/StatusBadge';
import type { Branch, Commit } from '../../../../../../lib/api';
import { sites } from '../../../../../../lib/hosts';
import { BRANCH_STATUS_LABEL, branchTone, groupTimeline, releaseName } from '../../../../../../lib/describe';
import { commitPath, projectPath, releasePath, releaseRequestPath } from '../../../../../../lib/paths';
import {
  getBranchByName,
  getBranchDetail,
  getCommit,
  getCommits,
  getMembers,
  getProject,
  getRelease,
  getReleaseRequests,
  getReleases,
  getViewer,
} from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

export async function generateMetadata({ params }: { params: Promise<ProjectParams & { branch: string }> }) {
  const { owner, project, branch } = await params;
  return { title: `${decodeURIComponent(branch)} · ${owner}/${project}` };
}

/** How many autosaves get a changed-files count; the drive keeps only a handful between versions. */
const AUTOSAVES_COUNTED = 10;

export default async function BranchPage({ params }: { params: Promise<ProjectParams & { branch: string }> }) {
  const { owner, project: slug, branch: name } = await params;
  const project = await getProject(owner, slug);
  const branch = await getBranchByName(project.id, name);
  const [detail, commits, requests, releases, viewer, members] = await Promise.all([
    getBranchDetail(branch.id),
    getCommits(branch.id),
    getReleaseRequests(project.id),
    getReleases(project.id),
    getViewer(),
    getMembers(project.id),
  ]);
  const base = branch.baseReleaseNumber ? await getRelease(project.id, branch.baseReleaseNumber) : null;
  const changes = diffManifests(base?.files ?? [], detail.files);
  const branchRequests = requests.filter((candidate) => candidate.branchName === branch.name);
  const request = branchRequests.find((candidate) => candidate.status === 'open' || candidate.status === 'candidate');
  const shipped = branchRequests.find((candidate) => candidate.status === 'released');
  const shippedRelease = shipped ? releases.find((release) => release.releaseRequestNumber === shipped.number) : undefined;
  const latest = releases.reduce<(typeof releases)[number] | null>((best, release) => (!best || release.number > best.number ? release : best), null);
  const baseRelease = releases.find((release) => release.number === branch.baseReleaseNumber);
  const canManage = project.role === 'owner' || project.role === 'maintainer';
  const canWrite = canManage || project.role === 'contributor';
  const mine = Boolean(viewer && branch.checkedOutBy === viewer.id);
  const heldByOther = Boolean(branch.checkedOutBy && !mine);
  const holderIsMember = members.some((member) => member.userId === branch.checkedOutBy);
  const timeline = groupTimeline(commits);
  const autosaves = commits.filter((commit) => commit.kind === 'autosave');
  const autosaveChanges = await countAutosaveChanges(autosaves.slice(0, AUTOSAVES_COUNTED), commits);
  const { siteUrl } = sites();
  const active = branch.status === 'open' || branch.status === 'frozen';

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
                Release request #{request.number}: {request.title}
              </Link>
            )}
            <span>
              From{' '}
              {branch.baseReleaseNumber ? (
                <Link href={releasePath(owner, slug, branch.baseReleaseNumber)}>{baseRelease ? releaseName(baseRelease) : `v${branch.baseReleaseNumber}`}</Link>
              ) : (
                'an empty project'
              )}
            </span>
          </>
        }
      />
      {active && latest && latest.number > (branch.baseReleaseNumber ?? 0) && (
        <p className="notice" role="status">
          <Link href={releasePath(owner, slug, latest.number)}>{releaseName(latest)}</Link> was released after this branch started. A release request compares
          this branch with v{latest.number}, and files changed on both sides need a pick.
        </p>
      )}
      <div className="page-grid">
        <div className="stack">
          <section className="section">
            <h2>{branch.baseReleaseNumber ? `Changes from v${branch.baseReleaseNumber}` : 'Changes'}</h2>
            {changes.length > 0 && <p className="change-summary">{changeSummary(changes)}</p>}
            <ChangeList projectId={project.id} changes={changes} empty={branch.baseReleaseNumber ? `Nothing has changed since v${branch.baseReleaseNumber}.` : 'No files yet.'} />
            {changes.length === 0 && branch.status === 'open' && canWrite && (
              <p className="muted">
                Files reach a branch only from the GigaCAD drive or <code className="mono">giga checkout</code> and <code className="mono">giga commit</code>. Files
                you upload in the browser go to the project’s root files, which aren’t part of a release.{' '}
                <a href={`${siteUrl}/docs/first-project`}>Your first project</a>
              </p>
            )}
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
                          <p className="muted">Autosaves are cleared when the next version is committed.</p>
                          <ul>
                            {entry.commits.map((commit) => {
                              const changed = autosaveChanges.get(commit.id);
                              return (
                                <li key={commit.id}>
                                  <Link href={commitPath(owner, slug, commit.id)}>
                                    <RelativeTime value={commit.createdAt} />
                                  </Link>{' '}
                                  <span className="muted">
                                    · @{commit.authorHandle || 'unknown'}
                                    {changed !== undefined && ` · ${changed === 1 ? '1 file' : `${changed} files`} changed`}
                                  </span>
                                </li>
                              );
                            })}
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
        </div>
        <aside className="request-rail">
          <LockCard
            branch={branch}
            owner={owner}
            slug={slug}
            mine={mine}
            canWrite={canWrite}
            canManage={canManage}
            holderIsMember={holderIsMember}
            request={request}
            shipped={shipped && { number: shipped.number, release: shippedRelease }}
            baseReleaseNumber={branch.baseReleaseNumber}
            siteUrl={siteUrl}
          />
          {canWrite && branch.status === 'open' && (
            <section className="rail-card">
              <h2>Open release request</h2>
              {heldByOther ? (
                <p className="muted">
                  @{branch.checkedOutByHandle} has this branch checked out. A release request can be opened once they check it in
                  {canManage ? ', or once you force-release their lock' : ''}.
                </p>
              ) : changes.length === 0 ? (
                <p className="muted">
                  Nothing to release yet: this branch has no changes{branch.baseReleaseNumber ? ` from v${branch.baseReleaseNumber}` : ''}. Commit a version from the
                  GigaCAD drive or the CLI first.
                </p>
              ) : (
                <>
                  <p className="muted">
                    This checks the branch in and freezes it: nobody can save to it until the request is released or closed. You can close the request any time to
                    unfreeze it.
                  </p>
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
                </>
              )}
            </section>
          )}
          {canManage && branch.status === 'open' && (
            <section className="rail-card">
              <h2>Archive branch</h2>
              <p className="muted">Archived branches are read-only and hidden from the branch list. Their history stays, and you can restore them.</p>
              <ActionButton action={archiveBranch.bind(null, branch.id)} className="btn btn-danger btn-small" confirm={archiveConfirm(branch, autosaves.length, mine)}>
                Archive
              </ActionButton>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Who holds the branch, or why nobody can, by its status, with the actions that fit the viewer. */
function LockCard({
  branch,
  owner,
  slug,
  mine,
  canWrite,
  canManage,
  holderIsMember,
  request,
  shipped,
  baseReleaseNumber,
  siteUrl,
}: {
  branch: Branch;
  owner: string;
  slug: string;
  mine: boolean;
  canWrite: boolean;
  canManage: boolean;
  holderIsMember: boolean;
  request: { number: number; title: string } | undefined;
  shipped: { number: number; release: { number: number; title: string | null } | undefined } | undefined;
  baseReleaseNumber: number | null;
  siteUrl: string;
}) {
  if (branch.status === 'frozen') {
    return (
      <section className="rail-card">
        <h2>Frozen</h2>
        <p>
          {request ? (
            <>
              Frozen for <Link href={releaseRequestPath(owner, slug, request.number)}>release request #{request.number}</Link>.
            </>
          ) : (
            'Frozen for a release request.'
          )}{' '}
          Nobody can save to it until the request is released or closed.
        </p>
      </section>
    );
  }
  if (branch.status === 'released') {
    return (
      <section className="rail-card">
        <h2>Released</h2>
        <p>
          {shipped?.release ? (
            <>
              Released as <Link href={releasePath(owner, slug, shipped.release.number)}>{releaseName(shipped.release)}</Link>
            </>
          ) : (
            'Released'
          )}
          {shipped && (
            <>
              {' '}
              from <Link href={releaseRequestPath(owner, slug, shipped.number)}>release request #{shipped.number}</Link>
            </>
          )}
          . It’s read-only now; start a new branch to keep working.
        </p>
      </section>
    );
  }
  if (branch.status === 'archived') {
    return (
      <section className="rail-card">
        <h2>Archived</h2>
        <p>
          Archived{branch.archivedByHandle && ` by @${branch.archivedByHandle}`}
          {branch.archivedAt && (
            <>
              {' '}
              <RelativeTime value={branch.archivedAt} />
            </>
          )}
          . It’s read-only.
          {canWrite && (
            <>
              {' '}
              To keep working, restore it or <Link href={projectPath(owner, slug, 'branches')}>start a new branch</Link>
              {baseReleaseNumber ? ` from v${baseReleaseNumber}` : ''}.
            </>
          )}
        </p>
        {canManage && (
          <ActionButton action={unarchiveBranch.bind(null, branch.id)} className="btn btn-secondary btn-small" pendingLabel="Restoring…">
            Restore branch
          </ActionButton>
        )}
      </section>
    );
  }
  return (
    <section className="rail-card">
      <h2>{mine ? 'Checked out by you' : 'Checked out'}</h2>
      {mine ? (
        <>
          <p>
            You have it checked out{branch.checkedOutMachine && ` on ${branch.checkedOutMachine}`}
            {branch.checkedOutAt && (
              <>
                {' '}
                since <RelativeTime value={branch.checkedOutAt} />
              </>
            )}
            . Nobody else can save to it until you check it in.
          </p>
          <ActionButton
            action={checkInBranch.bind(null, branch.id)}
            className="btn btn-secondary btn-small"
            pendingLabel="Checking in…"
            confirm={`Check in ${branch.name}? ${branch.checkedOutMachine ? `Saving from ${branch.checkedOutMachine}` : 'Saving'} stops until you check it out again. Your autosaves stay on the branch.`}
          >
            Check in
          </ActionButton>
        </>
      ) : branch.checkedOutByHandle ? (
        <p>
          Checked out by <strong>@{branch.checkedOutByHandle}</strong>
          {branch.checkedOutMachine && ` on ${branch.checkedOutMachine}`}
          {branch.checkedOutAt && (
            <>
              {' '}
              since <RelativeTime value={branch.checkedOutAt} />
            </>
          )}
          . Only they can save to it until they check it in.
        </p>
      ) : (
        <p>No one has this branch checked out.</p>
      )}
      {canWrite && !branch.checkedOutBy && (
        <p className="muted">
          Check it out from the GigaCAD drive or with <code className="mono">giga checkout</code>. <a href={`${siteUrl}/docs/check-out`}>How checking out works</a>
        </p>
      )}
      {canManage && branch.checkedOutBy && !mine && (
        <>
          <p className="muted">
            {holderIsMember
              ? 'If they’ve gone quiet, you can take the lock back. Their unsaved autosaves stay on the branch, and they’re told.'
              : `@${branch.checkedOutByHandle} is no longer a member, so they can’t check it in. Release the lock to free the branch.`}
          </p>
          <ActionButton
            action={forceReleaseLock.bind(null, branch.id)}
            className="btn btn-danger btn-small"
            confirm={`Force-release @${branch.checkedOutByHandle}’s lock on ${branch.name}? They’ll need to check it out again to keep saving.`}
          >
            Force-release lock
          </ActionButton>
        </>
      )}
    </section>
  );
}

/** Archiving says what happens to a lock and to unsaved work before it happens. */
function archiveConfirm(branch: Branch, autosaves: number, mine: boolean): string {
  const parts = [`Archive ${branch.name}? It becomes read-only.`];
  if (branch.checkedOutBy) {
    parts.push(mine ? 'Your checkout is released.' : `@${branch.checkedOutByHandle}’s checkout${branch.checkedOutMachine ? ` on ${branch.checkedOutMachine}` : ''} is released, and they’re told.`);
  }
  if (autosaves > 0) parts.push(`Its ${autosaves === 1 ? 'autosave stays' : `${autosaves} autosaves stay`} in the history; restore the branch to keep working on ${autosaves === 1 ? 'it' : 'them'}.`);
  return parts.join(' ');
}

/** How many files each autosave changed from the snapshot before it. A failed read just leaves the count out. */
async function countAutosaveChanges(autosaves: readonly Commit[], commits: readonly Commit[]): Promise<Map<string, number>> {
  const ids = new Set(autosaves.flatMap((commit) => [commit.id, ...(commit.parentId ? [commit.parentId] : [])]));
  const known = new Set(commits.map((commit) => commit.id));
  const details = await Promise.all([...ids].filter((id) => known.has(id)).map((id) => getCommit(id).catch(() => null)));
  const files = new Map(details.flatMap((detail) => (detail ? [[detail.commit.id, detail.files] as const] : [])));
  const counts = new Map<string, number>();
  for (const commit of autosaves) {
    const after = files.get(commit.id);
    const before = commit.parentId ? files.get(commit.parentId) : [];
    if (after && before) counts.set(commit.id, diffManifests(before, after).length);
  }
  return counts;
}
