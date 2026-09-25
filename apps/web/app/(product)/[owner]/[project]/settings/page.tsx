import { deleteProject, removeMember, setApprovalRules, setMember, updateProject } from '../../../actions';
import { ActionButton } from '../../../../../components/product/ActionButton';
import { ActionForm } from '../../../../../components/product/ActionForm';
import { PageHead } from '../../../../../components/product/PageHead';
import { projectPath } from '../../../../../lib/paths';
import { getApprovalRules, getMembers, getProject } from '../../../../../lib/product';
import type { ProjectParams } from '../layout';

export const metadata = { title: 'Project settings' };

export default async function ProjectSettings({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project: slug } = await params;
  const project = await getProject(owner, slug);
  const canManage = project.role === 'owner' || project.role === 'maintainer';
  const isOwner = project.role === 'owner';
  const [members, rules] = await Promise.all([getMembers(project.id),getApprovalRules(project.id)]);
  return <div className="page page-narrow"><PageHead crumbs={[{label:owner},{label:project.name,href:projectPath(owner,slug)},{label:'Settings'}]} title="Project settings" />
    <section className="section"><h2>General</h2><ActionForm action={updateProject.bind(null,project.id)} submitLabel="Save project"><label className="field"><span>Name</span><input name="name" defaultValue={project.name} required maxLength={100} disabled={!canManage} /></label><label className="field"><span>Description</span><textarea name="description" defaultValue={project.description} maxLength={2000} disabled={!canManage} /></label><label className="field"><span>Visibility</span><select name="visibility" defaultValue={project.visibility} disabled={!canManage}><option value="private">Private</option><option value="public">Public</option></select></label><label className="field"><span>License</span><input name="license" defaultValue={project.license ?? ''} maxLength={100} disabled={!canManage} /></label></ActionForm></section>
    <section className="section"><h2>Members</h2><div className="table-wrap"><table className="data-table"><thead><tr><th>Person</th><th>Role</th><th></th></tr></thead><tbody>{members.map(member => <tr key={member.userId}><td>@{member.handle}</td><td>{member.role}</td><td className="cell-action">{isOwner && member.role !== 'owner' && <ActionButton action={removeMember.bind(null,project.id,member.handle)} className="btn btn-danger btn-small" confirm={`Remove @${member.handle} from this project?`}>Remove</ActionButton>}</td></tr>)}</tbody></table></div>
      {isOwner && <ActionForm action={setMember.bind(null,project.id)} submitLabel="Add or update member" className="form form-inline"><label className="field"><span>Handle</span><input name="handle" placeholder="@alex" required /></label><label className="field"><span>Role</span><select name="role"><option value="viewer">Viewer</option><option value="contributor">Contributor</option><option value="maintainer">Maintainer</option></select></label></ActionForm>}
    </section>
    <section className="section"><h2>Approval rules</h2><ActionForm action={setApprovalRules.bind(null,project.id)} submitLabel="Save approval rules"><label className="field"><span>Required approvals</span><input type="number" name="requiredCount" min="0" max="20" defaultValue={rules.requiredCount} disabled={!canManage} /></label><fieldset className="field"><legend>Eligible roles</legend><div className="choice-list">{(['owner','maintainer','contributor','viewer'] as const).map(role => <label key={role} className="choice"><input type="checkbox" name="approverRoles" value={role} defaultChecked={rules.approverRoles.includes(role)} disabled={!canManage} />{role}</label>)}</div></fieldset><fieldset className="field"><legend>Eligible people</legend><div className="choice-list">{members.map(member => <label key={member.userId} className="choice"><input type="checkbox" name="approverUserIds" value={member.userId} defaultChecked={rules.approverUserIds.includes(member.userId)} disabled={!canManage} />@{member.handle}</label>)}</div></fieldset><label className="choice"><input type="checkbox" name="allowSelfApproval" defaultChecked={rules.allowSelfApproval} disabled={!canManage} />Allow requester to approve</label><label className="choice"><input type="checkbox" name="requireCleanRebuild" defaultChecked={rules.requireCleanRebuild} disabled={!canManage} />Require a clean SolidWorks rebuild</label></ActionForm></section>
    {isOwner && <section className="section"><h2>Delete project</h2><p className="section-intro">Deletion starts a 30-day grace period. Type <span className="mono">{slug}</span> to confirm.</p><ActionForm action={deleteProject.bind(null,project.id,slug)} submitLabel="Delete project" submitClassName="btn btn-danger"><label className="field"><span>Project slug</span><input name="confirm" required autoComplete="off" /></label></ActionForm></section>}
  </div>;
}
