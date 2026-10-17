import Link from 'next/link';
import { approveCandidate, closeReleaseRequest, generateCandidate, releaseCandidate, withdrawApproval } from '../../../../actions';
import { ActionButton } from '../../../../../../components/product/ActionButton';
import { DownloadButton } from '../../../../../../components/product/DownloadButton';
import { MarkdownText } from '../../../../../../components/product/MarkdownText';
import { PageHead } from '../../../../../../components/product/PageHead';
import { PickEditor } from '../../../../../../components/product/PickEditor';
import { PreviewButton } from '../../../../../../components/product/PreviewButton';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { ReleaseForm } from '../../../../../../components/product/ReleaseForm';
import { ApproveButton, NextStep, RequestActionButton, RequestDraftProvider } from '../../../../../../components/product/RequestDraft';
import { StatusBadge } from '../../../../../../components/product/StatusBadge';
import type { ReleaseBlocker } from '@gigacad/core';
import type { ReleaseRequestDetail } from '../../../../../../lib/api';
import { REBUILD_STATUS_LABEL, blockerText, eligibleApprovers, errorText, requestBadge, ruleSummary, warningText } from '../../../../../../lib/describe';
import { sites } from '../../../../../../lib/hosts';
import { branchPath, projectPath, releasePath, releaseRequestPath } from '../../../../../../lib/paths';
import { previewFormat } from '../../../../../../lib/preview';
import { getVisibleMembers, getViewer, getProject, getRebuildReport, getRelease, getReleaseRequestByNumber, isFullMember, parseNumber } from '../../../../../../lib/product';
import { nextStep } from '../../../../../../lib/request-next';
import type { ProjectParams } from '../../layout';

type RequestParams = ProjectParams & { number: string };

export async function generateMetadata({ params }: { params: Promise<RequestParams> }) {
  const { owner, project: slug, number } = await params;
  // A missing request 404s from the page itself. Throwing here would stream the error after a 200.
  const request = await getProject(owner, slug)
    .then((project) => getReleaseRequestByNumber(project.id, parseNumber(number)))
    .then((detail) => detail.releaseRequest)
    .catch(() => null);
  if (!request) return { title: 'Not found' };
  return { title: `#${request.number} ${request.title} · ${owner}/${slug}` };
}

/** How many rebuild messages show before the rest fold away. */
const REPORT_SHOWN = 10;
const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

/** Rules for a request finished before its rules were recorded: none shown, nothing judged. */
const UNRECORDED_RULES = { requiredCount: 0, approverUserIds: [], approverRoles: [], allowSelfApproval: false, requireCleanRebuild: false };

export default async function RequestPage({ params, searchParams }: { params: Promise<RequestParams>; searchParams: Promise<{ report?: string }> }) {
  const { owner, project: slug, number } = await params;
  const wholeReport = (await searchParams).report === 'all';
  const project = await getProject(owner, slug);
  const detail = await getReleaseRequestByNumber(project.id, parseNumber(number));
  const { releaseRequest: request, preview, candidate, approvals, latestRelease, targetRelease, releasedRelease, history } = detail;
  const finished = request.status === 'released' || request.status === 'closed';
  // Finished requests read against the main they targeted; active ones against the latest.
  const mainRelease = finished ? targetRelease : latestRelease;
  const [me, visibleMembers, main] = await Promise.all([getViewer(), getVisibleMembers(project.id), mainRelease ? getRelease(project.id, mainRelease.number) : Promise.resolve(null)]);
  // Only the project's own members get ids and roles, so outsiders see who has approved rather than who may.
  const outsider = !project.role;
  const members = visibleMembers.filter(isFullMember);
  const rulesRecorded = approvals.rules !== null;
  const rules = approvals.rules ?? UNRECORDED_RULES;
  const requester = request.requesterHandle ? `@${request.requesterHandle}` : 'the requester';
  const canManage = project.role === 'owner' || project.role === 'maintainer';
  const canWrite = canManage || project.role === 'contributor';
  const isRequester = Boolean(me && me.id === request.requesterId);
  // The requester and maintainers drive a request; everyone else reviews it.
  const canDrive = !finished && ((isRequester && canWrite) || canManage);
  const eligible = finished || outsider ? [] : eligibleApprovers(members, rules, request.requesterId);
  const mayApprove = eligible.some((member) => member.userId === me?.id);
  const counted = new Set(approvals.evaluation?.countedUserIds ?? []);
  const approved = Boolean(me && counted.has(me.id));
  // An approval of this candidate stops counting if an export of one of its files changed after it.
  const exportChanged = (approval: { candidateManifestId: string; createdAt: string }) =>
    approval.candidateManifestId === request.candidateManifestId && Boolean(approvals.exportsChangedAt && approval.createdAt < approvals.exportsChangedAt);
  const mine = approvals.given.find((approval) => approval.userId === me?.id && approval.candidateManifestId === request.candidateManifestId && !exportChanged(approval));
  const releaseNumber = latestRelease ? latestRelease.number + 1 : 1;
  const blockers = approvals.evaluation?.blockers ?? [];
  const approvalBlocker = blockers.find((blocker) => blocker.kind === 'needs_approvals');
  const otherBlockers = blockers.filter((blocker) => blocker.kind !== 'needs_approvals');
  const current = Boolean(candidate?.upToDate);
  const ready = current && Boolean(approvals.evaluation?.canRelease);
  // A driver whose own approval is the last thing missing may approve and release in one confirmed step.
  const approveAndRelease = Boolean(
    current && canDrive && mayApprove && !mine && approvalBlocker && approvalBlocker.kind === 'needs_approvals' && approvalBlocker.need - approvalBlocker.have === 1 && otherBlockers.length === 0,
  );
  const report = request.rebuildReport;
  const reportCurrent = Boolean(candidate && request.rebuildStatus && request.rebuildManifestId === candidate.manifestId);
  // A report on a candidate built on an older main no longer vouches for what would be released.
  const reportOutdated = reportCurrent && candidate?.upToDate === false;
  // The whole report, on request; the detail carries only the most severe messages.
  const allMessages = wholeReport && report && report.total > report.messages.length ? (await getRebuildReport(request.id)).messages : report?.messages ?? [];
  const rebuild = reportCurrent && request.rebuildStatus ? { status: request.rebuildStatus, errors: report?.counts.error ?? 0, warnings: report?.counts.warning ?? 0 } : null;
  const rebuildCaution =
    rebuild?.status === 'failed' ? `The last SolidWorks rebuild failed (${plural(rebuild.errors, 'error')}).` : rebuild?.status === 'passed_with_warnings' ? `The last SolidWorks rebuild passed with ${plural(rebuild.warnings, 'warning')}.` : null;
  const showRebuild = request.rebuildStatus !== null || (!finished && rules.requireCleanRebuild);
  const handles = new Map(members.map((member) => [member.userId, member.handle]));
  const waitingOn = eligible.filter((member) => !counted.has(member.userId)).map((member) => member.handle);
  const badge = requestBadge({ status: request.status, upToDate: candidate?.upToDate ?? true, rebuildStatus: reportCurrent ? request.rebuildStatus : null }, rules.requireCleanRebuild);
  const pathOf = (itemId: string) => main?.files.find((file) => file.itemId === itemId)?.path ?? preview.rows.find((row) => row.itemId === itemId)?.path;
  const rebuiltElsewhere = candidate ? candidate.rebuilt.filter((file) => !preview.rows.some((row) => row.itemId === file.itemId)).length : 0;
  const currentApprovals = approvals.given.filter((approval) => approval.candidateManifestId === request.candidateManifestId);
  const resets = [
    currentApprovals.length ? `${plural(currentApprovals.length, 'approval')} (${currentApprovals.map((approval) => `@${approval.handle}`).join(', ')})` : null,
    reportCurrent ? 'the rebuild report' : null,
  ].filter(Boolean);
  const resetWarning = resets.length ? resets.join(' and ') : null;
  const { siteUrl } = sites();
  const settingsRules = `${projectPath(owner, slug, 'settings')}#approval-rules`;

  const step = finished
    ? null
    : nextStep({
        requesterHandle: request.requesterHandle,
        branchName: request.branchName,
        canDrive,
        isRequester,
        canChangeRules: project.role === 'owner',
        ownerHandle: project.ownerHandle,
        mayApprove,
        approved,
        picksOk: preview.ok,
        changesMain: detail.changesMain,
        hasCandidate: Boolean(candidate),
        upToDate: current,
        canRelease: Boolean(approvals.evaluation?.canRelease),
        blockers,
        releaseNumber,
        latestNumber: latestRelease?.number ?? null,
        rules,
        handles,
        waitingOn,
        rebuild,
      });
  const buildButton = (
    <RequestActionButton action={generateCandidate.bind(null, request.id)} className="btn btn-primary" pendingLabel="Building…" changesCandidate>
      Build candidate
    </RequestActionButton>
  );
  const regenerateButton = (
    <RequestActionButton
      action={generateCandidate.bind(null, request.id)}
      disabled={!preview.ok}
      className="btn btn-primary"
      pendingLabel="Regenerating…"
      confirm={resetWarning ? `Regenerating the candidate clears ${resetWarning}.` : undefined}
      changesCandidate
    >
      Regenerate candidate
    </RequestActionButton>
  );

  const rebuildCard = showRebuild && (
    <section className="rail-card" key="rebuild" id="rebuild">
      <h2>Rebuild</h2>
      {request.rebuildStatus && report ? (
        <>
          <p className="rebuild-status">
            <StatusBadge tone={!reportCurrent || reportOutdated ? 'quiet' : request.rebuildStatus === 'failed' ? 'danger' : request.rebuildStatus === 'passed_with_warnings' ? 'caution' : 'signal'}>
              {REBUILD_STATUS_LABEL[request.rebuildStatus]}
            </StatusBadge>
            <span className="muted">
              {report.reportedAt && <RelativeTime value={report.reportedAt} />}
              {report.reportedBy && ` by @${report.reportedBy.handle ?? 'someone'}`}
              {report.via === 'device' ? (report.deviceName ? ` from “${report.deviceName}”` : ' from a desktop sign-in') : report.via === 'session' ? ' from the website' : ''}
              {report.reportedBy?.handle && report.reportedBy.handle === request.requesterHandle && ', who opened this request'}
              {!reportCurrent ? ' · for an older candidate' : reportOutdated ? ' · for an outdated candidate' : ''}
            </span>
          </p>
          {report.total > 0 && (
            <p className="muted rebuild-counts">
              {[report.counts.error && plural(report.counts.error, 'error'), report.counts.warning && plural(report.counts.warning, 'warning'), report.counts.info && plural(report.counts.info, 'note')].filter(Boolean).join(', ')}
            </p>
          )}
          {allMessages.length > 0 && <RebuildMessages projectId={project.id} messages={allMessages.slice(0, REPORT_SHOWN)} files={candidate?.files ?? []} />}
          {allMessages.length > REPORT_SHOWN && (
            <details className="rebuild-more" open={wholeReport}>
              <summary>{plural(allMessages.length - REPORT_SHOWN, 'more message')}</summary>
              <RebuildMessages projectId={project.id} messages={allMessages.slice(REPORT_SHOWN)} files={candidate?.files ?? []} />
            </details>
          )}
          {report.total > allMessages.length && (
            <p className="muted">
              Showing the {allMessages.length} most severe of {report.total.toLocaleString('en-US')} messages.{' '}
              <Link href={`${releaseRequestPath(owner, slug, request.number)}?report=all#rebuild`} scroll={false}>
                Show all
              </Link>
            </p>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            {candidate
              ? 'This project needs a clean SolidWorks rebuild before release. Open the candidate in SolidWorks with the GigaCAD add-in and rebuild it'
              : 'This project needs a clean SolidWorks rebuild before release. After the candidate is built, open it in SolidWorks with the GigaCAD add-in and rebuild it'}
            , or attach a report from your own rebuild with <code className="mono">giga rr rebuild-report</code>. <a href={`${siteUrl}/docs/cli`}>How to attach a report</a>
          </p>
          {history.lastCandidateChange && candidate && <p className="muted">The previous rebuild, if any, was for an older candidate.</p>}
          {project.role === 'owner' ? (
            <p className="muted">
              <Link href={settingsRules}>Turn off the rebuild rule</Link> if this project doesn’t use the add-in yet.
            </p>
          ) : (
            canManage && <p className="muted">If this project doesn’t use the add-in yet, ask @{project.ownerHandle} to turn off the rebuild rule.</p>
          )}
        </>
      )}
    </section>
  );

  const releaseCard = canDrive && (
    <section className="rail-card" key="release">
      <h2>Release</h2>
      {!preview.ok ? (
        <p className="muted">Fix the pick errors to build a candidate.</p>
      ) : !detail.changesMain ? (
        <p className="muted">Nothing to release: these picks leave main as it is.</p>
      ) : !candidate ? (
        buildButton
      ) : !candidate.upToDate ? (
        <>
          <p className="muted">Main moved on since this candidate was built.</p>
          {regenerateButton}
        </>
      ) : (
        <>
          <ReleaseForm
            action={releaseCandidate.bind(null, request.id, owner, slug)}
            releaseNumber={releaseNumber}
            fileCount={candidate.files.length}
            approve={approveAndRelease}
            blocked={ready || approveAndRelease ? null : releaseStatus(blockers)}
            caution={rebuildCaution}
          />
        </>
      )}
      {candidate && <CandidateFiles projectId={project.id} files={candidate.files} />}
    </section>
  );
  const rebuildFirst = Boolean(rebuild && rebuild.status !== 'passed');

  return (
    <div className="page">
      <PageHead
        crumbs={[{ label: owner, href: `/${owner}` }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Release requests', href: projectPath(owner, slug, 'release-requests') }, { label: `#${request.number}` }]}
        title={request.title}
        meta={
          <>
            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
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
      <RequestDraftProvider candidateId={candidate?.manifestId ?? null} exportsChangedAt={approvals.exportsChangedAt}>
        {releasedRelease && (
          <p className="next-step is-done" role="status">
            <span>
              Released as <Link href={releasePath(owner, slug, releasedRelease.number)}>v{releasedRelease.number}</Link>
              {releasedRelease.createdByHandle && ` by @${releasedRelease.createdByHandle}`}, <RelativeTime value={releasedRelease.createdAt} />. These are the picks it was released with.
            </span>
          </p>
        )}
        {request.status === 'closed' && (
          <p className="next-step" role="status">
            <span>
              Closed{history.closed?.actorHandle && ` by @${history.closed.actorHandle}`}
              {history.closed && (
                <>
                  , <RelativeTime value={history.closed.at} />
                </>
              )}
              . Nothing was released. {branchState(detail, owner, slug)}
            </span>
          </p>
        )}
        {step && (
          <NextStep
            tone={step.tone}
            action={step.build ? buildButton : undefined}
            change={history.lastCandidateChange ? `${history.lastCandidateChange.actorHandle ? `@${history.lastCandidateChange.actorHandle}` : 'Someone'} ${CHANGE_TEXT[history.lastCandidateChange.kind]}` : null}
          >
            {step.text}
            {step.rules && canManage && (
              <>
                {' '}
                <Link href={settingsRules}>Approval rules</Link>
              </>
            )}
          </NextStep>
        )}
        {history.snapshot && (
          <p className="muted request-note">
            Opening this request saved {plural(history.snapshot.autosaves, 'unsaved autosave')}
            {history.snapshot.authorHandle && ` from @${history.snapshot.authorHandle}`} as a version, so they’re included.
          </p>
        )}
        {request.body && <MarkdownText className="notes">{request.body}</MarkdownText>}
        <div className="request-grid">
          <div className="stack">
            <section>
              <h2>File picks</h2>
              {!finished && !canDrive && <p className="muted request-note">Only {requester} or a maintainer can change the picks.</p>}
              <PickEditor
                key={request.id}
                projectId={project.id}
                requestId={request.id}
                rows={preview.rows}
                picks={request.picks}
                mainFiles={main?.files ?? []}
                baseNumber={detail.branch.baseReleaseNumber}
                latestNumber={mainRelease?.number ?? null}
                nextNumber={finished ? null : releaseNumber}
                finished={finished ? (request.status as 'released' | 'closed') : null}
                readOnly={!canDrive}
                picksOk={preview.ok}
                hasCandidate={Boolean(candidate)}
                resetWarning={resetWarning}
                rebuiltElsewhere={rebuiltElsewhere}
                releasedBlobs={request.status === 'released' && candidate ? Object.fromEntries(candidate.files.map((file) => [file.itemId, file.blob])) : undefined}
              />
            </section>
            {candidate && candidate.rebuilt.length > 0 && (
              <section className="section">
                <h2>Changed after the candidate was built</h2>
                <p className="muted">
                  A SolidWorks rebuild saved these files into the candidate.{' '}
                  {request.status === 'released' ? 'They were released like this.' : request.status === 'closed' ? 'They would have been released like this.' : 'They will be released like this, not as picked.'}
                </p>
                <ul className="file-list">
                  {candidate.rebuilt.map((file) => (
                    <li key={file.itemId}>
                      <span className="mono">{file.path}</span>
                      <span className="pick-files">
                        {previewFormat(file.path) && (
                          <PreviewButton projectId={project.id} sha256={file.blob} path={file.path} format={previewFormat(file.path)!} compare={file.builtBlob ? { sha256: file.builtBlob, path: file.path } : undefined} captions={['As picked', 'After rebuild']} />
                        )}
                        <DownloadButton projectId={project.id} sha256={file.blob} path={file.path} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {preview.warnings.length > 0 && (
              <section className="section">
                <h2>Warnings</h2>
                <ul className="warning-list">
                  {preview.warnings.map((warning, index) => (
                    <li key={index}>{warningText(warning)}</li>
                  ))}
                </ul>
              </section>
            )}
            {preview.errors.length > 0 && (
              <section className="section">
                <h2>Pick errors</h2>
                <ul className="error-list">
                  {preview.errors.map((error, index) => (
                    <li key={index}>{errorText(error, pathOf)}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <aside className="request-rail" aria-label="Request status">
            {rebuildFirst && rebuildCard}
            {releaseCard}
            <section className="rail-card">
              <h2>{!rulesRecorded ? 'Approvals' : rules.requiredCount === 0 ? 'Approvals · Not required' : `Approvals · ${approvals.evaluation?.countedUserIds.length ?? 0} of ${rules.requiredCount}`}</h2>
              {rulesRecorded && <p className="muted">{ruleSummary(rules, handles)}</p>}
              {finished || outsider ? (
                approvals.given.length ? (
                  <ul className="approvers">
                    {approvals.given.map((approval) => (
                      <li key={approval.userId}>
                        <span className="approver-name" title={`@${approval.handle}`}>
                          @{approval.handle}
                          {me && approval.userId === me.id && <span className="muted"> (you)</span>}
                        </span>
                        <span className={counted.has(approval.userId) ? 'badge badge-signal approver-state' : 'muted approver-state'}>{counted.has(approval.userId) ? 'Approved' : 'Older candidate'}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">{finished ? 'No one approved it.' : 'No approvals yet.'}</p>
                )
              ) : rules.requiredCount > 0 && eligible.length ? (
                <ul className="approvers">
                  {eligible.map((member) => {
                    const approval = approvals.given.find((given) => given.userId === member.userId);
                    const isCurrent = approval?.candidateManifestId === request.candidateManifestId && !exportChanged(approval);
                    return (
                      <li key={member.userId}>
                        <span className="approver-name" title={`@${member.handle}`}>
                          @{member.handle}
                          {me && member.userId === me.id && <span className="muted"> (you)</span>}
                        </span>
                        <span className={isCurrent ? 'badge badge-signal approver-state' : 'muted approver-state'}>{approval ? (isCurrent ? 'Approved' : exportChanged(approval) ? 'Export changed' : 'Older candidate') : 'Waiting'}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {!finished && approvals.given.some(exportChanged) && (
                <p className="muted">
                  A STEP or STL export of a file in the candidate changed after {approvals.given.filter(exportChanged).length === 1 ? 'an approval' : 'some approvals'}, so they need giving again.
                </p>
              )}
              {!finished && approvals.given.some((approval) => approval.candidateManifestId !== request.candidateManifestId) && history.lastCandidateChange && (
                <p className="muted">
                  The candidate changed after the older approvals: {history.lastCandidateChange.actorHandle ? `@${history.lastCandidateChange.actorHandle}` : 'someone'} {CHANGE_TEXT[history.lastCandidateChange.kind]}{' '}
                  <RelativeTime value={history.lastCandidateChange.at} />.
                </p>
              )}
              {!finished && me && !mayApprove && project.role && candidate && <p className="muted">{whyNotApprover(isRequester, rules.allowSelfApproval)}</p>}
              {!finished && current && mayApprove && rules.requiredCount > 0 && (
                mine ? (
                  <ActionButton action={withdrawApproval.bind(null, request.id)}>Withdraw approval</ActionButton>
                ) : (
                  <ApproveButton action={approveCandidate.bind(null, request.id, canDrive ? null : `${requester} or a maintainer`)} />
                )
              )}
            </section>
            {!rebuildFirst && rebuildCard}
            {canDrive && (
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
      </RequestDraftProvider>
    </div>
  );
}

const CHANGE_TEXT: Record<NonNullable<ReleaseRequestDetail['history']['lastCandidateChange']>['kind'], string> = {
  picks_changed: 'saved new picks',
  candidate_generated: 'regenerated it',
  candidate_updated: 'saved rebuilt files into it',
};

/**
 * What still stands between a current candidate and its release, in one line for the
 * Release card. Rebuild and rule problems are explained once, in their own places.
 */
function releaseStatus(blockers: readonly ReleaseBlocker[]): string {
  const approvals = blockers.find((blocker) => blocker.kind === 'needs_approvals');
  const parts = [
    approvals ? blockerText(approvals) : null,
    blockers.some((blocker) => blocker.kind.startsWith('rebuild_')) ? 'Needs a clean SolidWorks rebuild; see Rebuild.' : null,
    blockers.some((blocker) => blocker.kind === 'not_enough_eligible_approvers') ? 'The approval rules can’t be met yet; see above.' : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Not ready to release yet.';
}

function whyNotApprover(isRequester: boolean, allowSelfApproval: boolean): string {
  if (isRequester && !allowSelfApproval) return 'You opened this request, and self-approval is off, so you can’t approve it.';
  return 'You can review this candidate, but the approval rules don’t include you.';
}

/** For a closed request: what its branch is doing now, which may have moved on since. */
function branchState(detail: ReleaseRequestDetail, owner: string, slug: string) {
  const name = detail.releaseRequest.branchName;
  const { status, activeRequestNumber } = detail.branch;
  if (status === 'open') return `Its branch, ${name}, is open for work.`;
  if (status === 'frozen' && activeRequestNumber) {
    return (
      <>
        Its branch, {name}, is frozen again for <Link href={releaseRequestPath(owner, slug, activeRequestNumber)}>#{activeRequestNumber}</Link>.
      </>
    );
  }
  if (status === 'released') return `Its branch, ${name}, was released through another request.`;
  if (status === 'archived') return `Its branch, ${name}, was archived.`;
  return '';
}

/** Rebuild messages, most severe first, each with a way to open the file it's about when the candidate has it. */
function RebuildMessages({ projectId, messages, files }: { projectId: string; messages: { level: 'info' | 'warning' | 'error'; message: string; path?: string }[]; files: { path: string; blob: string }[] }) {
  return (
    <ul className="rebuild-list">
      {messages.map((message, index) => {
        const file = message.path ? files.find((entry) => entry.path.toLowerCase() === message.path!.toLowerCase()) : undefined;
        return (
          <li key={index} className={`is-${message.level}`}>
            <span className="sr-only">{message.level === 'error' ? 'Error: ' : message.level === 'warning' ? 'Warning: ' : 'Note: '}</span>
            {message.path && (
              <>
                <bdi className="mono">{message.path}</bdi>:{' '}
              </>
            )}
            <span className="rebuild-message">{message.message}</span>
            {file && <DownloadButton projectId={projectId} sha256={file.blob} path={file.path} />}
          </li>
        );
      })}
    </ul>
  );
}

/** The candidate's files, folded away, each downloadable. Long lists show the first files only. */
function CandidateFiles({ projectId, files }: { projectId: string; files: { itemId: string; path: string; blob: string }[] }) {
  const shown = files.slice(0, 200);
  return (
    <details className="candidate-files">
      <summary>{plural(files.length, 'file')} in the candidate</summary>
      <ul className="file-list">
        {shown.map((file) => (
          <li key={file.itemId}>
            <span className="mono">{file.path}</span>
            <DownloadButton projectId={projectId} sha256={file.blob} path={file.path} />
          </li>
        ))}
      </ul>
      {files.length > shown.length && <p className="muted">And {plural(files.length - shown.length, 'more file')}. Download the release once it’s made for all of them.</p>}
    </details>
  );
}
