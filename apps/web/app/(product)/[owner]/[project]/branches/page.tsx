import Link from 'next/link';
import { createBranch } from '../../../actions';
import { ActionForm } from '../../../../../components/product/ActionForm';
import { EmptyState } from '../../../../../components/product/EmptyState';
import { PageHead } from '../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../components/product/RelativeTime';
import { StatusBadge } from '../../../../../components/product/StatusBadge';
import { BRANCH_STATUS_LABEL, branchTone } from '../../../../../lib/describe';
import { branchPath, projectPath } from '../../../../../lib/paths';
import { getBranches, getProject, getReleases, getViewer } from '../../../../../lib/product';
import type { ProjectParams } from '../layout';

export const metadata = { title: 'Branches' };

export default async function Branches({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project: slug } = await params;
  const project = await getProject(owner, slug);
  const [branches, releases, me] = await Promise.all([getBranches(project.id), getReleases(project.id), getViewer()]);
  const canWrite = project.role === 'owner' || project.role === 'maintainer' || project.role === 'contributor';
  return <div className="page">
    <PageHead crumbs={[{ label: owner }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Branches' }]} title="Branches" />
    {canWrite && <section className="section"><h2>New branch</h2>
      <ActionForm action={createBranch.bind(null, project.id, owner, slug)} submitLabel="Create branch" className="form form-inline">
        <label className="field"><span>Name</span><input name="name" required maxLength={100} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" placeholder="gripper-redesign" /></label>
        {releases.length > 0 && <label className="field"><span>Start from</span><select name="fromRelease">{releases.map(release => <option key={release.id} value={release.number}>v{release.number}</option>)}</select></label>}
      </ActionForm>
    </section>}
    {branches.length === 0 ? <EmptyState title="No branches yet."><p>Create a branch to start work toward a release.</p></EmptyState> :
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Branch</th><th>Status</th><th>From</th><th>Checkout</th><th>Created</th></tr></thead><tbody>
        {branches.map(branch => <tr key={branch.id}><td><Link className="mono" href={branchPath(owner, slug, branch.name)}>{branch.name}</Link></td><td><StatusBadge tone={branchTone(branch.status)}>{BRANCH_STATUS_LABEL[branch.status]}</StatusBadge></td><td className="mono">{branch.baseReleaseNumber ? `v${branch.baseReleaseNumber}` : 'Empty'}</td><td>{me && branch.checkedOutBy === me.id ? 'You' : branch.checkedOutByHandle ? `@${branch.checkedOutByHandle} on ${branch.checkedOutMachine}` : '—'}</td><td><RelativeTime value={branch.createdAt} /></td></tr>)}
      </tbody></table></div>}
  </div>;
}
