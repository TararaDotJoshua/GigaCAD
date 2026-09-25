import { diffManifests } from '@gigacad/core';
import Link from 'next/link';
import { EmptyState } from '../../../../../../components/product/EmptyState';
import { PageHead } from '../../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { changeVerb } from '../../../../../../lib/describe';
import { branchPath, projectPath } from '../../../../../../lib/paths';
import { getBranchDetail, getCommit, getProject } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

export default async function CommitPage({ params }: { params: Promise<ProjectParams & { id: string }> }) {
  const { owner, project: slug, id } = await params;
  const project = await getProject(owner, slug);
  const detail = await getCommit(id);
  const branch = await getBranchDetail(detail.commit.branchId);
  if (branch.branch.projectId !== project.id) return <EmptyState title="Commit not found in this project." />;
  const parent = detail.commit.parentId ? await getCommit(detail.commit.parentId) : null;
  const changes = diffManifests(parent?.files ?? [], detail.files);
  return <div className="page"><PageHead crumbs={[{label:owner},{label:project.name,href:projectPath(owner,slug)},{label:branch.branch.name,href:branchPath(owner,slug,branch.branch.name)},{label:id.slice(0,8)}]} title={detail.commit.versionLabel || (detail.commit.kind === 'autosave' ? 'Autosave' : 'Version')} meta={<><span>By @{detail.commit.authorHandle || 'unknown'} · <RelativeTime value={detail.commit.createdAt} /></span><span className="mono">{id.slice(0,8)}</span></>} />
    {detail.commit.message && <p className="notes">{detail.commit.message}</p>}
    <section className="section"><h2>Changes</h2>{changes.length ? <ul className="meta-list">{changes.map(change => <li key={change.itemId}><strong>{changeVerb(change)}</strong> <span className="mono">{change.kind === 'deleted' ? change.before.path : change.after.path}</span></li>)}</ul> : <EmptyState title="No file changes in this snapshot." />}</section>
    <Link href={branchPath(owner,slug,branch.branch.name)}>Back to branch</Link>
  </div>;
}
