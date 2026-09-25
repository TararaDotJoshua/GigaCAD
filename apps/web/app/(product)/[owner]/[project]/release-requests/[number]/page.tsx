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
import { getApprovalRules, getMe, getMembers, getProject, getRelease, getReleaseRequestByNumber, parseNumber } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

export default async function RequestPage({ params }: { params: Promise<ProjectParams & { number: string }> }) {
  const { owner, project: slug, number } = await params;
  const project = await getProject(owner, slug);
  const detail = await getReleaseRequestByNumber(project.id, parseNumber(number));
  const { releaseRequest: request, preview, candidate, approvals, latestRelease } = detail;
  const [me, members, rules, main] = await Promise.all([getMe(), getMembers(project.id), getApprovalRules(project.id), latestRelease ? getRelease(project.id,latestRelease.number) : Promise.resolve(null)]);
  const finished = request.status === 'released' || request.status === 'closed';
  const canWrite = project.role === 'owner' || project.role === 'maintainer' || project.role === 'contributor';
  const eligible = eligibleApprovers(members,rules,request.requesterId);
  const mayApprove = eligible.some(member => member.userId === me.id);
  const mine = approvals.given.find(approval => approval.userId === me.id && approval.candidateManifestId === request.candidateManifestId);
  const releaseNumber = latestRelease ? latestRelease.number + 1 : 1;
  const released = request.releasedReleaseId && latestRelease?.id === request.releasedReleaseId ? latestRelease.number : null;
  return <div className="page">
    <PageHead crumbs={[{label:owner},{label:project.name,href:projectPath(owner,slug)},{label:'Release requests',href:projectPath(owner,slug,'release-requests')},{label:`#${request.number}`}]} title={request.title} meta={<><StatusBadge tone={requestTone(request.status)}>{REQUEST_STATUS_LABEL[request.status]}</StatusBadge><span><Link href={branchPath(owner,slug,request.branchName)} className="mono">{request.branchName}</Link> into main {latestRelease ? `v${latestRelease.number}` : '(first release)'}</span><span>Opened by @{request.requesterHandle || 'unknown'} · <RelativeTime value={request.createdAt} /></span></>} />
    {request.body && <p className="notes">{request.body}</p>}
    <div className="request-grid"><div className="stack"><section><h2>File picks</h2><PickEditor key={request.updatedAt} requestId={request.id} rows={preview.rows} picks={request.picks} mainFiles={main?.files ?? []} latestNumber={latestRelease?.number ?? null} readOnly={finished || !canWrite} /></section>
      {preview.warnings.length > 0 && <section className="section"><h2>Warnings</h2><ul className="warning-list">{preview.warnings.map((warning,index) => <li key={index}>{warning.kind.replace(/_/g,' ')}: <span className="mono">{warning.path}</span></li>)}</ul></section>}
      {preview.errors.length > 0 && <section className="section"><h2>Pick errors</h2><ul className="error-list">{preview.errors.map((error,index) => <li key={index}>{error.kind.replace(/_/g,' ')}{ 'path' in error ? `: ${error.path}` : ''}{'reason' in error ? `: ${error.reason}` : ''}</li>)}</ul></section>}
      {finished && released && <Link className="btn btn-secondary" href={releasePath(owner,slug,released)}>Open released v{released}</Link>}
    </div><aside className="request-rail">
      <section className="rail-card"><h2>Candidate</h2>{candidate ? <><p><StatusBadge tone={candidate.upToDate ? 'signal' : 'caution'}>{candidate.upToDate ? 'Up to date' : 'Out of date'}</StatusBadge></p><p>{candidate.files.length} files</p></> : <p className="muted">No candidate yet.</p>}{!finished && canWrite && <ActionButton action={generateCandidate.bind(null,request.id)} disabled={!preview.ok} className="btn btn-primary">{candidate ? 'Regenerate candidate' : 'Generate candidate'}</ActionButton>}</section>
      <section className="rail-card"><h2>Rebuild</h2>{request.rebuildStatus ? <><StatusBadge tone={request.rebuildStatus === 'failed' ? 'danger' : request.rebuildStatus === 'passed_with_warnings' ? 'caution' : 'signal'}>{request.rebuildStatus.replace(/_/g,' ')}</StatusBadge>{request.rebuildReport?.messages.length ? <ul className="warning-list">{request.rebuildReport.messages.map((message,index) => <li key={index}>{message.path && <span className="mono">{message.path}: </span>}{message.message}</li>)}</ul> : null}</> : <p className="muted">{rules.requireCleanRebuild ? 'Rebuild this candidate from the SolidWorks add-in.' : 'No rebuild report yet.'}</p>}</section>
      <section className="rail-card"><h2>Approvals · {approvals.evaluation?.countedUserIds.length ?? 0} of {rules.requiredCount}</h2>{eligible.length ? <ul className="approvers">{eligible.map(member => { const approval = approvals.given.find(given => given.userId === member.userId); return <li key={member.userId}><span>@{member.handle}</span><span className={approval?.candidateManifestId === request.candidateManifestId ? 'badge badge-signal' : 'muted'}>{approval ? approval.candidateManifestId === request.candidateManifestId ? 'Approved' : 'Older candidate' : 'Waiting'}</span></li>; })}</ul> : <p className="muted">No eligible approvers under the current rules.</p>}{!finished && candidate?.upToDate && mayApprove && (mine ? <ActionButton action={withdrawApproval.bind(null,request.id)}>Withdraw approval</ActionButton> : <ActionButton action={approveCandidate.bind(null,request.id)} className="btn btn-primary">Approve candidate</ActionButton>)}</section>
      {!finished && canWrite && <section className="rail-card"><h2>Release</h2>{approvals.evaluation?.blockers.length ? <ul className="warning-list">{approvals.evaluation.blockers.map((blocker,index) => <li key={index}>{blockerText(blocker)}</li>)}</ul> : !candidate ? <p className="muted">Generate a candidate first.</p> : null}{candidate?.upToDate && approvals.evaluation?.canRelease && <ActionForm action={releaseCandidate.bind(null,request.id,owner,slug)} submitLabel={`Release v${releaseNumber}`}><label className="field"><span>Notes</span><textarea name="notes" rows={3} /></label></ActionForm>}<p><ActionButton action={closeReleaseRequest.bind(null,request.id)} className="btn btn-danger btn-small" confirm="Close this request and unfreeze the branch?">Close request</ActionButton></p></section>}
    </aside></div>
  </div>;
}
