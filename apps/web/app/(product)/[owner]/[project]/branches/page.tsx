import Link from 'next/link';
import { createBranch } from '../../../actions';
import { ActionForm } from '../../../../../components/product/ActionForm';
import { BranchNameField } from '../../../../../components/product/BranchNameField';
import { EmptyState } from '../../../../../components/product/EmptyState';
import { PageHead } from '../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../components/product/RelativeTime';
import { StatusBadge } from '../../../../../components/product/StatusBadge';
import { BRANCH_STATUS_LABEL, branchTone, releaseName } from '../../../../../lib/describe';
import { branchPath, projectPath, releasePath } from '../../../../../lib/paths';
import { getBranches, getProject, getReleases, getViewer } from '../../../../../lib/product';
import type { ProjectParams } from '../layout';

export const metadata = { title: 'Branches' };

export default async function Branches({ params, searchParams }: { params: Promise<ProjectParams>; searchParams: Promise<{ all?: string }> }) {
  const [{ owner, project: slug }, query] = await Promise.all([params, searchParams]);
  const project = await getProject(owner, slug);
  const [branches, releases, me] = await Promise.all([getBranches(project.id), getReleases(project.id), getViewer()]);
  const canWrite = project.role === 'owner' || project.role === 'maintainer' || project.role === 'contributor';
  // Released and archived branches are done, so they wait behind a link, as in the Branches folder.
  const showAll = query.all === '1';
  const active = branches.filter((branch) => branch.status === 'open' || branch.status === 'frozen');
  const finished = branches.length - active.length;
  const shown = showAll ? branches : active;
  const newest = Math.max(0, ...releases.map((release) => release.number));
  const byNumber = new Map(releases.map((release) => [release.number, release]));
  return (
    <div className="page">
      <PageHead crumbs={[{ label: owner, href: `/${owner}` }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Branches' }]} title="Branches" />
      {canWrite && (
        <section className="section">
          <h2>New branch</h2>
          <ActionForm action={createBranch.bind(null, project.id, owner, slug)} submitLabel="Create branch" className="form form-inline">
            <BranchNameField />
            {releases.length > 0 && (
              <label className="field">
                <span>Start from</span>
                <select name="fromRelease" defaultValue={newest}>
                  {releases.map((release) => (
                    <option key={release.id} value={release.number}>
                      {releaseName(release)}
                      {release.number === newest ? ' (latest)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </ActionForm>
        </section>
      )}
      {branches.length === 0 ? (
        <EmptyState title="No branches yet.">
          <p>Create a branch to start work toward a release.</p>
        </EmptyState>
      ) : (
        <>
          {shown.length === 0 ? (
            <EmptyState title="No open branches." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>Status</th>
                    <th>From</th>
                    <th>Checked out by</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((branch) => {
                    const base = branch.baseReleaseNumber ? byNumber.get(branch.baseReleaseNumber) : undefined;
                    return (
                      <tr key={branch.id}>
                        <td>
                          <Link className="mono" href={branchPath(owner, slug, branch.name)}>
                            {branch.name}
                          </Link>
                        </td>
                        <td>
                          <StatusBadge tone={branchTone(branch.status)}>{BRANCH_STATUS_LABEL[branch.status]}</StatusBadge>
                        </td>
                        <td>
                          {branch.baseReleaseNumber ? (
                            <Link href={releasePath(owner, slug, branch.baseReleaseNumber)} title={base ? releaseName(base) : undefined}>
                              v{branch.baseReleaseNumber}
                            </Link>
                          ) : (
                            <span className="muted">Empty project</span>
                          )}
                        </td>
                        <td>
                          {me && branch.checkedOutBy === me.id
                            ? `You${branch.checkedOutMachine ? ` on ${branch.checkedOutMachine}` : ''}`
                            : branch.checkedOutByHandle
                              ? `@${branch.checkedOutByHandle}${branch.checkedOutMachine ? ` on ${branch.checkedOutMachine}` : ''}`
                              : '—'}
                        </td>
                        <td>
                          <RelativeTime value={branch.createdAt} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {finished > 0 && (
            <p className="muted">
              {showAll ? (
                <Link href={projectPath(owner, slug, 'branches')}>Hide released and archived branches</Link>
              ) : (
                <Link href={`${projectPath(owner, slug, 'branches')}?all=1`}>Show released and archived branches ({finished})</Link>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
