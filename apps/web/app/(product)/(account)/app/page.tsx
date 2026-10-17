import { isPlaceholderHandle } from '@gigacad/core';
import Link from 'next/link';
import { leaveProject, saveProfile } from '../../actions';
import { ActionButton } from '../../../../components/product/ActionButton';
import { ActionForm } from '../../../../components/product/ActionForm';
import { EmptyState } from '../../../../components/product/EmptyState';
import { GettingStarted } from '../../../../components/product/GettingStarted';
import { HandleField } from '../../../../components/product/HandleField';
import { NeedsYou } from '../../../../components/product/NeedsYou';
import { PageHead } from '../../../../components/product/PageHead';
import { RefreshOnFocus } from '../../../../components/product/RefreshOnFocus';
import { PlusIcon } from '../../../../components/icons';
import type { DeletedProject, Project } from '../../../../lib/api';
import { getNeedsYou } from '../../../../lib/needs-you';
import { getDeletedProjects, getMe, getMyProjects, suggestHandle } from '../../../../lib/product';
import { projectPath } from '../../../../lib/paths';
import { getViewerEmail } from '../../../../lib/session';

export const metadata = { title: 'Your projects' };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ device?: string; deleted?: string }> }) {
  const [me, projects, { device, deleted }] = await Promise.all([getMe(), getMyProjects(), searchParams]);
  const needsHandle = isPlaceholderHandle(me.handle);
  const suggested = needsHandle ? await suggestHandle(await getViewerEmail()) : '';
  const mine = projects.filter((project) => project.ownerHandle === me.handle);
  const shared = projects.filter((project) => project.ownerHandle !== me.handle);
  const pending = projects.length ? await getNeedsYou(me, projects) : null;
  // The notice names a project that really is deleted, never whatever text is in the address.
  const deletedProject: DeletedProject | undefined = deleted ? (await getDeletedProjects()).find((project) => project.slug === deleted) : undefined;

  return (
    <div className="page">
      <PageHead
        crumbs={[]}
        title="Your projects"
        actions={
          // Until there's a handle, choosing one (below) is the only next step.
          needsHandle ? undefined : (
            <Link href="/new" className="btn btn-primary">
              <PlusIcon className="icon" />
              New project
            </Link>
          )
        }
      />
      {device === 'approved' && (
        <p className="notice" role="status">
          Device approved. You can go back to it now.
        </p>
      )}
      {deletedProject && (
        <p className="notice" role="status">
          Deleted {deletedProject.name}. You can restore it for 30 days, under <Link href="/settings#deleted">Account</Link>.
        </p>
      )}

      {needsHandle && (
        <section className="card">
          <h2>Choose your handle</h2>
          <p className="card-intro">Project addresses start with it, and it appears next to everything you do. Choose it before your first project. You can change it later in Account settings.</p>
          <ActionForm action={saveProfile} submitLabel="Save handle" pendingLabel="Saving…" className="form form-inline">
            <HandleField defaultValue={suggested} />
          </ActionForm>
        </section>
      )}

      <RefreshOnFocus />
      {pending && <NeedsYou pending={pending} />}

      {projects.length === 0 ? (
        !needsHandle && (
          <EmptyState title="No projects yet.">
            <p>A project holds your CAD files, their branches, and every release.</p>
            <p>
              Joining a team? Send them your handle, <strong>@{me.handle}</strong>. Projects they add you to show up here.
            </p>
            <Link href="/new" className="btn btn-primary btn-small">
              Create a project
            </Link>
            <GettingStarted compact />
          </EmptyState>
        )
      ) : (
        <>
          {mine.length > 0 && (
            <section className="section">
              <ProjectTable projects={mine} label="Your projects" showRole={false} />
            </section>
          )}
          {shared.length > 0 && (
            <section className="section">
              <h2>Shared with you</h2>
              <ProjectTable projects={shared} label="Shared with you" showRole leaveAs={me.handle} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ProjectTable({ projects, label, showRole, leaveAs }: { projects: Project[]; label: string; showRole: boolean; leaveAs?: string }) {
  return (
    <table className="data-table" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">Project</th>
          {showRole && <th scope="col">Your role</th>}
          <th scope="col">Visibility</th>
          <th scope="col">Latest release</th>
          {leaveAs && (
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {projects.map((project) => (
          <tr key={project.id}>
            <td>
              <Link href={projectPath(project.ownerHandle, project.slug)} className="row-link">
                <strong>{project.name}</strong>
                <span className="mono muted">
                  {project.ownerHandle}/{project.slug}
                </span>
              </Link>
            </td>
            {showRole && <td className="muted role">{project.role ?? 'viewer'}</td>}
            <td className="muted">{project.visibility === 'public' ? 'Public' : 'Private'}</td>
            <td className="mono">{project.latestReleaseNumber ? `v${project.latestReleaseNumber}` : <span className="muted">None yet</span>}</td>
            {leaveAs && (
              <td className="cell-action">
                <ActionButton
                  action={leaveProject.bind(null, project.id, leaveAs)}
                  className="btn btn-secondary btn-small"
                  confirm={`Leave ${project.name}? You lose access unless someone adds you again.`}
                  ariaLabel={`Leave ${project.ownerHandle}/${project.slug}`}
                >
                  Leave
                </ActionButton>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
