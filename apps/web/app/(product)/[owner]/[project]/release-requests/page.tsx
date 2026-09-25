import Link from 'next/link';
import { EmptyState } from '../../../../../components/product/EmptyState';
import { PageHead } from '../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../components/product/RelativeTime';
import { StatusBadge } from '../../../../../components/product/StatusBadge';
import { REQUEST_STATUS_LABEL, requestTone } from '../../../../../lib/describe';
import { projectPath, releaseRequestPath } from '../../../../../lib/paths';
import { getProject, getReleaseRequests } from '../../../../../lib/product';
import type { ProjectParams } from '../layout';

export const metadata = { title: 'Release requests' };

export default async function ReleaseRequests({ params, searchParams }: { params: Promise<ProjectParams>; searchParams: Promise<{ view?: string }> }) {
  const { owner, project: slug } = await params;
  const project = await getProject(owner, slug);
  const [requests, { view }] = await Promise.all([getReleaseRequests(project.id), searchParams]);
  const shown = view === 'all' ? requests : requests.filter(request => request.status === 'open' || request.status === 'candidate');
  return <div className="page"><PageHead crumbs={[{label:owner},{label:project.name,href:projectPath(owner,slug)},{label:'Release requests'}]} title="Release requests" meta={<span>Pick files from a branch, build a candidate, and release it to main.</span>} />
    <div className="toolbar"><Link className={`btn ${view === 'all' ? 'btn-secondary' : 'btn-primary'}`} href={projectPath(owner,slug,'release-requests')}>Active</Link><Link className={`btn ${view === 'all' ? 'btn-primary' : 'btn-secondary'}`} href={`${projectPath(owner,slug,'release-requests')}?view=all`}>All</Link></div>
    {shown.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Branch</th><th>Opened by</th><th>Status</th><th>Updated</th></tr></thead><tbody>{shown.map(request => <tr key={request.id}><td><Link href={releaseRequestPath(owner,slug,request.number)}>#{request.number} {request.title}</Link></td><td className="mono">{request.branchName}</td><td>@{request.requesterHandle || 'unknown'}</td><td><StatusBadge tone={requestTone(request.status)}>{REQUEST_STATUS_LABEL[request.status]}</StatusBadge></td><td><RelativeTime value={request.updatedAt} /></td></tr>)}</tbody></table></div> : <EmptyState title={view === 'all' ? 'No release requests yet.' : 'No active release requests.'}><p>Open one from a branch.</p><Link className="btn btn-secondary" href={projectPath(owner,slug,'branches')}>Go to branches</Link></EmptyState>}
  </div>;
}
