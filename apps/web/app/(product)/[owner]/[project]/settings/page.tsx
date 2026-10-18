import { notFound } from 'next/navigation';
import { deleteProject, setApprovalRules, setMember, updateProject } from '../../../actions';
import { ActionForm } from '../../../../../components/product/ActionForm';
import { ApprovalRulesFields, MembersSection, VisibilityField } from '../../../../../components/product/MemberFields';
import { PageHead } from '../../../../../components/product/PageHead';
import { projectPath } from '../../../../../lib/paths';
import { getApprovalRules, getMe, getMembers, getProject } from '../../../../../lib/product';
import type { ProjectParams } from '../layout';

export async function generateMetadata({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project } = await params;
  return { title: `Project settings · ${owner}/${project}` };
}

export default async function ProjectSettings({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project: slug } = await params;
  const project = await getProject(owner, slug);
  const canManage = project.role === 'owner' || project.role === 'maintainer';
  // Settings are for the people who can change them, like the sidebar link.
  if (!canManage) notFound();
  const isOwner = project.role === 'owner';
  const [members, rules, me] = await Promise.all([getMembers(project.id), getApprovalRules(project.id), getMe()]);
  return (
    <div className="page page-narrow">
      <PageHead crumbs={[{ label: owner, href: `/${owner}` }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Settings' }]} title="Project settings" />

      <section className="section">
        <h2>General</h2>
        <ActionForm action={updateProject.bind(null, project.id)} submitLabel="Save project" discardable>
          <label className="field">
            <span>Name</span>
            <input name="name" defaultValue={project.name} required maxLength={100} />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea name="description" defaultValue={project.description} maxLength={2000} />
          </label>
          <VisibilityField
            initial={project.visibility}
            mustStayPrivate={project.mustStayPrivate}
            disabled={!isOwner}
            forkCount={project.forkCount}
            {...(isOwner ? {} : { hint: `Only @${project.ownerHandle} can change who can see the project.` })}
          />
          <label className="field">
            <span>License</span>
            <input name="license" defaultValue={project.license ?? ''} maxLength={100} />
          </label>
        </ActionForm>
      </section>

      <section className="section" id="members">
        <h2>Members</h2>
        <p className="section-intro">Files that members upload count against @{project.ownerHandle}’s storage.</p>
        <MembersSection projectId={project.id} members={members} viewerId={me.id} isOwner={isOwner} canManage={canManage} addMember={setMember.bind(null, project.id)} />
      </section>

      <section className="section" id="approval-rules">
        <h2>Approval rules</h2>
        {isOwner ? (
          <ActionForm action={setApprovalRules.bind(null, project.id)} submitLabel="Save approval rules" discardable>
            <ApprovalRulesFields rules={rules} members={members} disabled={false} />
          </ActionForm>
        ) : (
          <div className="form">
            <p className="section-intro">Only @{project.ownerHandle} can change the approval rules, so no one can loosen them to release their own request.</p>
            <ApprovalRulesFields rules={rules} members={members} disabled />
          </div>
        )}
      </section>

      {isOwner && (
        <section className="section card card-danger">
          <h2>Delete project</h2>
          <p className="section-intro">
            You can restore it from Account for 30 days, and its address stays reserved until then. After that, it’s gone for good. Type the project’s address,{' '}
            <span className="mono">{slug}</span>, to confirm.
          </p>
          <ActionForm action={deleteProject.bind(null, project.id, slug)} submitLabel="Delete project" submitClassName="btn btn-danger">
            <label className="field">
              <span>Project address</span>
              <input name="confirm" required autoComplete="off" spellCheck={false} />
            </label>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
