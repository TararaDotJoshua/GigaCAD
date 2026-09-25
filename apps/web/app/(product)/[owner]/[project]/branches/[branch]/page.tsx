import Link from 'next/link';
import { archiveBranch, forceReleaseLock, openReleaseRequest } from '../../../../actions';
import { ActionButton } from '../../../../../../components/product/ActionButton';
import { ActionForm } from '../../../../../../components/product/ActionForm';
import { EmptyState } from '../../../../../../components/product/EmptyState';
import { FileTable } from '../../../../../../components/product/FileTable';
import { PageHead } from '../../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { StatusBadge } from '../../../../../../components/product/StatusBadge';
import { BRANCH_STATUS_LABEL, branchTone, groupTimeline } from '../../../../../../lib/describe';
import { branchPath, commitPath, projectPath } from '../../../../../../lib/paths';
import { getBranchByName, getBranchDetail, getCommits, getProject } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

export default async function BranchPage({ params }: { params: Promise<ProjectParams & { branch: string }> }) {
  const { owner, project: slug, branch: name } = await params;
  const project = await getProject(owner, slug);
  const branch = await getBranchByName(project.id, name);
  const [detail, commits] = await Promise.all([getBranchDetail(branch.id), getCommits(branch.id)]);
  const canManage = project.role === 'owner' || project.role === 'maintainer';
  const canWrite = canManage || project.role === 'contributor';
  const timeline = groupTimeline(commits);
  return <div className="page">
    <PageHead crumbs={[{label:owner},{label:project.name,href:projectPath(owner,slug)},{label:'Branches',href:projectPath(owner,slug,'branches')},{label:branch.name}]} title={<span className="mono">{branch.name}</span>} meta={<><StatusBadge tone={branchTone(branch.status)}>{BRANCH_STATUS_LABEL[branch.status]}</StatusBadge><span>From {branch.baseReleaseNumber ? `v${branch.baseReleaseNumber}` : 'an empty project'}</span></>} />
    <div className="page-grid"><div className="stack">
      <section className="section"><h2>Files at branch head</h2>{detail.files.length ? <FileTable projectId={project.id} files={detail.files} /> : <EmptyState title="No files yet." />}</section>
      <section className="section"><h2>Version history</h2>{timeline.length ? <ol className="timeline">{timeline.map((entry, index) => <li key={entry.kind === 'version' ? entry.commit.id : `autosaves-${index}`} className="timeline-item"><span className="timeline-node" /><div className="timeline-body">{entry.kind === 'version' ? <><Link className="timeline-title" href={commitPath(owner,slug,entry.commit.id)}>{entry.commit.versionLabel || 'Version'}</Link><p className="timeline-meta">@{entry.commit.authorHandle || 'unknown'} · <RelativeTime value={entry.commit.createdAt} /></p>{entry.commit.message && <p className="timeline-text">{entry.commit.message}</p>}</> : <details><summary>Unsaved work · {entry.commits.length} autosave{entry.commits.length === 1 ? '' : 's'}</summary><ul>{entry.commits.map(commit => <li key={commit.id}><Link href={commitPath(owner,slug,commit.id)}><RelativeTime value={commit.createdAt} /></Link></li>)}</ul></details>}</div></li>)}</ol> : <EmptyState title="No versions yet." />}</section>
    </div><aside className="request-rail"><section className="rail-card"><h2>Checkout</h2>{branch.checkedOutByHandle ? <p>Checked out by <strong>@{branch.checkedOutByHandle}</strong>{branch.checkedOutMachine && ` on ${branch.checkedOutMachine}`}{branch.checkedOutAt && <> · <RelativeTime value={branch.checkedOutAt} /></>}</p> : <p>No one has this branch checked out.</p>}<p className="muted">Use the GigaCAD drive or <code className="mono">giga checkout</code> to check out this branch.</p>{canManage && branch.checkedOutBy && <ActionButton action={forceReleaseLock.bind(null,branch.id)} className="btn btn-danger btn-small" confirm={`Force-release the lock on ${branch.name}?`}>Force-release lock</ActionButton>}</section>
      {canWrite && branch.status === 'open' && <section className="rail-card"><h2>Open release request</h2><p className="muted">Opening a request checks this branch in and freezes it until the request closes.</p><ActionForm action={openReleaseRequest.bind(null,branch.id,owner,slug)} submitLabel="Open release request"><label className="field"><span>Title</span><input name="title" required maxLength={200} /></label><label className="field"><span>Description</span><textarea name="body" rows={3} /></label></ActionForm></section>}
      {canManage && branch.status === 'open' && <section className="rail-card"><h2>Archive branch</h2><ActionButton action={archiveBranch.bind(null,branch.id)} className="btn btn-danger" confirm={`Archive ${branch.name}?`}>Archive</ActionButton></section>}
    </aside></div>
  </div>;
}
