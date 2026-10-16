import Link from 'next/link';
import { EmptyState } from '../../../../../components/product/EmptyState';
import { PageHead } from '../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../components/product/RelativeTime';
import { StatusBadge } from '../../../../../components/product/StatusBadge';
import { REQUEST_STATUS_LABEL, requestTone } from '../../../../../lib/describe';
import { projectPath, releaseRequestPath } from '../../../../../lib/paths';
import type { ReleaseRequestDetail } from '../../../../../lib/api';
import { getApprovalRules, getProject, getReleaseRequest, getReleaseRequests } from '../../../../../lib/product';
import type { ProjectParams } from '../layout';

export const metadata = { title: 'Release requests' };

export default async function ReleaseRequests({ params, searchParams }: { params: Promise<ProjectParams>; searchParams: Promise<{ view?: string }> }) {
  const { owner, project: slug } = await params;
  const project = await getProject(owner, slug);
  const [requests, { view }] = await Promise.all([getReleaseRequests(project.id), searchParams]);
  const active = requests.filter((request) => request.status === 'open' || request.status === 'candidate');
  const all = view === 'all';
  const shown = all ? requests : active;
  const base = projectPath(owner, slug, 'release-requests');
  // Where each candidate stands on approvals, so approvers can see what's waiting without opening each one.
  const candidates = shown.filter((request) => request.status === 'candidate');
  const [details, rules] = await Promise.all([
    Promise.all(candidates.map((request) => getReleaseRequest(request.id).catch(() => null))),
    candidates.length ? getApprovalRules(project.id).catch(() => null) : null,
  ]);
  const approvals = new Map(details.flatMap((detail) => (detail ? [[detail.releaseRequest.id, approvalState(detail, rules?.requiredCount ?? 0)] as const] : [])));
  return (
    <div className="page">
      <PageHead
        crumbs={[{ label: owner, href: `/${owner}` }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Release requests' }]}
        title="Release requests"
        meta={<span>Pick files from a branch and release them to main.</span>}
      />
      <nav className="segmented interval-toggle toolbar-tabs" aria-label="Which requests">
        <Link className={`segment${all ? '' : ' is-selected'}`} aria-current={all ? undefined : 'page'} href={base}>
          Active <span className="segment-count">{active.length}</span>
        </Link>
        <Link className={`segment${all ? ' is-selected' : ''}`} aria-current={all ? 'page' : undefined} href={`${base}?view=all`}>
          All <span className="segment-count">{requests.length}</span>
        </Link>
      </nav>
      {shown.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Request</th>
                <th scope="col">Branch</th>
                <th scope="col">Opened by</th>
                <th scope="col">Status</th>
                <th scope="col">Approvals</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((request) => (
                <tr key={request.id}>
                  <td>
                    <Link href={releaseRequestPath(owner, slug, request.number)}>
                      #{request.number} {request.title}
                    </Link>
                  </td>
                  <td className="mono">{request.branchName}</td>
                  <td>@{request.requesterHandle || 'unknown'}</td>
                  <td>
                    <StatusBadge tone={requestTone(request.status)}>{REQUEST_STATUS_LABEL[request.status]}</StatusBadge>
                  </td>
                  <td className="muted">{approvals.get(request.id) ?? (request.status === 'open' ? 'No candidate yet' : '—')}</td>
                  <td>
                    <RelativeTime value={request.updatedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={all ? 'No release requests yet.' : 'No active release requests.'}>
          <p>Open one from a branch when its work is ready to release.</p>
          <Link className="btn btn-secondary" href={projectPath(owner, slug, 'branches')}>
            Go to branches
          </Link>
        </EmptyState>
      )}
    </div>
  );
}

/** "1 of 2 approvals", or what else stands between the candidate and a release. */
function approvalState(detail: ReleaseRequestDetail, required: number): string {
  const evaluation = detail.approvals.evaluation;
  if (!detail.candidate?.upToDate) return 'Candidate out of date';
  if (!evaluation) return '—';
  if (evaluation.canRelease) return 'Ready to release';
  if (evaluation.blockers.some((blocker) => blocker.kind === 'needs_approvals')) return `${evaluation.countedUserIds.length} of ${required} approvals`;
  if (evaluation.blockers.some((blocker) => blocker.kind === 'not_enough_eligible_approvers')) return 'Not enough approvers';
  return 'Needs a clean rebuild';
}
