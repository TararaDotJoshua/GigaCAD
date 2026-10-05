import Link from 'next/link';
import { approveCandidate, closeReleaseRequest, generateCandidate, releaseCandidate, withdrawApproval } from '../../../../actions';
import { ActionButton } from '../../../../../../components/product/ActionButton';
import { ActionForm } from '../../../../../../components/product/ActionForm';
import { PageHead } from '../../../../../../components/product/PageHead';
import { PickEditor } from '../../../../../../components/product/PickEditor';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { StatusBadge } from '../../../../../../components/product/StatusBadge';
import { REQUEST_STATUS_LABEL, blockerText, eligibleApprovers, requestTone } from '../../../../../../lib/describe';
import { branchPath, projectPath, releasePath } from '../../../../../../lib/paths';
import { getApprovalRules, getMembers, getViewer, getProject, getRelease, getReleaseRequestByNumber, parseNumber } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

type RequestParams = ProjectParams & { number: string };

export async function generateMetadata({ params }: { params: Promise<RequestParams> }) {
  const { owner, project: slug, number } = await params;
  // A missing request 404s from the page itself. Throwing here would stream the error after a 200.
  const request = await getProject(owner, slug)
    .then((project) => getReleaseRequestByNumber(project.id, parseNumber(number)))
    .then((detail) => detail.releaseRequest)
    .catch(() => null);
  return { title: `${request ? `#${request.number} ${request.title}` : `#${number}`} · ${owner}/${slug}` };
}

export default async function RequestPage({ params }: { params: Promise<RequestParams> }) {
  const { owner, project: slug, number } = await params;
  const project = await getProject(owner, slug);
  const detail = await getReleaseRequestByNumber(project.id, parseNumber(number));
  const { releaseRequest: request, preview, candidate, approvals, latestRelease, targetRelease, releasedRelease } = detail;
  const finished = request.status === 'released' || request.status === 'closed';
  // Finished requests read against the main they targeted; active ones against the latest.
  const mainRelease = finished ? targetRelease : latestRelease;
  const [me, members, rules, main] = await Promise.all([getViewer(), getMembers(project.id), getApprovalRules(project.id), mainRelease ? getRelease(project.id, mainRelease.number) : Promise.resolve(null)]);
  const canWrite = project.role === 'owner' || project.role === 'maintainer' || project.role === 'contributor';
  const eligible = eligibleApprovers(members, rules, request.requesterId);
  const mayApprove = eligible.some((member) => member.userId === me?.id);
  const mine = approvals.given.find((approval) => approval.userId === me?.id && approval.candidateManifestId === request.candidateManifestId);
  const releaseNumber = latestRelease ? latestRelease.number + 1 : 1;
  const blockers = approvals.evaluation?.blockers ?? [];
  const approvalBlocker = blockers.find((blocker) => blocker.kind === 'needs_approvals');
  const otherBlockers = blockers.filter((blocker) => blocker.kind !== 'needs_approvals');
  const ready = Boolean(candidate?.upToDate && approvals.evaluation?.canRelease);
  // Your approval is the only thing missing: approve and release in one step.
  const approveAndRelease = Boolean(
    candidate?.upToDate && mayApprove && !mine && approvalBlocker && approvalBlocker.need - approvalBlocker.have === 1 && otherBlockers.length === 0,
  );
  const showRebuild = rules.requireCleanRebuild || request.rebuildStatus !== null;

  const next = finished
    ? request.status === 'released'
      ? null
      : 'This request was closed. Its branch is open for work again.'
    : !preview.ok
      ? 'Fix the pick errors below, then save your picks.'
      : !candidate
        ? canWrite
          ? 'Save your picks to build the candidate.'
          : 'Waiting for the requester to build a candidate.'
        : !candidate.upToDate
          ? `Main has a newer release. ${canWrite ? 'Rebuild the candidate to include it.' : 'The candidate needs rebuilding.'}`
          : ready
            ? `Ready to release v${releaseNumber}.`
            : approveAndRelease
              ? `Your approval is the last one needed. Approve and release v${releaseNumber} when the picks look right.`
              : otherBlockers.length
                ? blockerText(otherBlockers[0]!)
                : approvalBlocker
                  ? `Waiting for ${approvalBlocker.need - approvalBlocker.have} more ${approvalBlocker.need - approvalBlocker.have === 1 ? 'approval' : 'approvals'}${mayApprove && !mine ? ', including yours' : ''}.`
                  : null;

  return (
    <div className="page">
      <PageHead
        crumbs={[{ label: owner, href: `/${owner}` }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Release requests', href: projectPath(owner, slug, 'release-requests') }, { label: `#${request.number}` }]}
        title={request.title}
        meta={
          <>
            <StatusBadge tone={requestTone(request.status)}>{REQUEST_STATUS_LABEL[request.status]}</StatusBadge>
            <span>
              <Link href={branchPath(owner, slug, request.branchName)} className="mono">
                {request.branchName}
              </Link>{' '}
              into main {mainRelease ? `v${mainRelease.number}` : '(first release)'}
            </span>
            <span>
              Opened by @{request.requesterHandle || 'unknown'} · <RelativeTime value={request.createdAt} />
            </span>
          </>
        }
      />
      {releasedRelease && (
        <p className="next-step is-done" role="status">
          Released as <Link href={releasePath(owner, slug, releasedRelease.number)}>v{releasedRelease.number}</Link>. These are the picks it was released with.
        </p>
      )}
      {next && (
        <p className={ready || approveAndRelease ? 'next-step is-ready' : 'next-step'} role="status">
          <strong>Next:</strong> {next}
        </p>
      )}
      {request.body && <p className="notes">{request.body}</p>}
      <div className="request-grid">
        <div className="stack">
          <section>
            <h2>File picks</h2>
            <PickEditor
              key={request.id}
              projectId={project.id}
              requestId={request.id}
              rows={preview.rows}
              picks={request.picks}
              mainFiles={main?.files ?? []}
              latestNumber={mainRelease?.number ?? null}
              nextNumber={finished ? null : releaseNumber}
              readOnly={finished || !canWrite}
            />
          </section>
          {preview.warnings.length > 0 && (
            <section className="section">
              <h2>Warnings</h2>
              <ul className="warning-list">
                {preview.warnings.map((warning, index) => (
                  <li key={index}>
                    {warning.kind.replace(/_/g, ' ')}: <span className="mono">{warning.path}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {preview.errors.length > 0 && (
            <section className="section">
              <h2>Pick errors</h2>
              <ul className="error-list">
                {preview.errors.map((error, index) => (
                  <li key={index}>
                    {error.kind.replace(/_/g, ' ')}
                    {'path' in error ? `: ${error.path}` : ''}
                    {'reason' in error ? `: ${error.reason}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="request-rail">
          {!finished && canWrite && (
            <section className="rail-card">
              <h2>Release</h2>
              {candidate && !candidate.upToDate && (
                <>
                  <p className="muted">Main moved on since this candidate was built.</p>
                  <ActionButton action={generateCandidate.bind(null, request.id)} disabled={!preview.ok} className="btn btn-primary" pendingLabel="Rebuilding…">
                    Rebuild candidate
                  </ActionButton>
                </>
              )}
              {!candidate && preview.ok && (
                <ActionButton action={generateCandidate.bind(null, request.id)} className="btn btn-primary" pendingLabel="Building…">
                  Build candidate
                </ActionButton>
              )}
              {otherBlockers.length > 0 && (
                <ul className="warning-list">
                  {otherBlockers.map((blocker, index) => (
                    <li key={index}>{blockerText(blocker)}</li>
                  ))}
                </ul>
              )}
              {(ready || approveAndRelease) && (
                <ActionForm action={releaseCandidate.bind(null, request.id, owner, slug)} submitLabel={approveAndRelease ? `Approve and release v${releaseNumber}` : `Release v${releaseNumber}`} pendingLabel="Releasing…">
                  {approveAndRelease && <input type="hidden" name="approve" value="yes" />}
                  <p className="muted">Releasing locks these files as v{releaseNumber}, permanently.</p>
                  <label className="field">
                    <span>
                      Notes <em>optional</em>
                    </span>
                    <textarea name="notes" rows={3} />
                  </label>
                </ActionForm>
              )}
              {candidate && <p className="muted">{candidate.files.length} files in the candidate.</p>}
            </section>
          )}
          <section className="rail-card">
            <h2>
              Approvals · {approvals.evaluation?.countedUserIds.length ?? 0} of {rules.requiredCount}
            </h2>
            {eligible.length ? (
              <ul className="approvers">
                {eligible.map((member) => {
                  const approval = approvals.given.find((given) => given.userId === member.userId);
                  const current = approval?.candidateManifestId === request.candidateManifestId;
                  return (
                    <li key={member.userId}>
                      <span>@{member.handle}</span>
                      <span className={current ? 'badge badge-signal' : 'muted'}>{approval ? (current ? 'Approved' : 'Older candidate') : 'Waiting'}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">No eligible approvers under the current rules.</p>
            )}
            {!finished && candidate?.upToDate && mayApprove && !approveAndRelease && (mine ? <ActionButton action={withdrawApproval.bind(null, request.id)}>Withdraw approval</ActionButton> : <ActionButton action={approveCandidate.bind(null, request.id)} className="btn btn-primary">Approve candidate</ActionButton>)}
          </section>
          {showRebuild && (
            <section className="rail-card">
              <h2>Rebuild</h2>
              {request.rebuildStatus ? (
                <>
                  <StatusBadge tone={request.rebuildStatus === 'failed' ? 'danger' : request.rebuildStatus === 'passed_with_warnings' ? 'caution' : 'signal'}>{request.rebuildStatus.replace(/_/g, ' ')}</StatusBadge>
                  {request.rebuildReport?.messages.length ? (
                    <ul className="warning-list">
                      {request.rebuildReport.messages.map((message, index) => (
                        <li key={index}>
                          {message.path && <span className="mono">{message.path}: </span>}
                          {message.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : (
                <p className="muted">This project needs a clean rebuild before release. Open the candidate in SolidWorks with the GigaCAD add-in and rebuild it.</p>
              )}
            </section>
          )}
          {!finished && canWrite && (
            <section className="rail-card">
              <h2>Close request</h2>
              <p className="muted">Closing unfreezes the branch so work can continue. Nothing is released.</p>
              <ActionButton action={closeReleaseRequest.bind(null, request.id)} className="btn btn-danger btn-small" confirm="Close this request? The branch opens for work again, and the picks and candidate are kept here for reference.">
                Close request
              </ActionButton>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
