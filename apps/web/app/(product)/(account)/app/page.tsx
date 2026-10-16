import { isPlaceholderHandle } from '@gigacad/core';
import Link from 'next/link';
import { saveProfile } from '../../actions';
import { ActionForm } from '../../../../components/product/ActionForm';
import { EmptyState } from '../../../../components/product/EmptyState';
import { GettingStarted } from '../../../../components/product/GettingStarted';
import { HandleField } from '../../../../components/product/HandleField';
import { NeedsYou } from '../../../../components/product/NeedsYou';
import { PageHead } from '../../../../components/product/PageHead';
import { RefreshOnFocus } from '../../../../components/product/RefreshOnFocus';
import { PlusIcon } from '../../../../components/icons';
import { apiRequest, type DeletedProject, type Project } from '../../../../lib/api';
import { getNeedsYou } from '../../../../lib/needs-you';
import { getMe, getMyProjects, suggestHandle } from '../../../../lib/product';
import { projectPath } from '../../../../lib/paths';
import { getViewerEmail, requireAccessToken } from '../../../../lib/session';

export const metadata = { title: 'Your projects' };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ device?: string; deleted?: string }> }) {
  const [me, projects, { device, deleted }] = await Promise.all([getMe(), getMyProjects(), searchParams]);
  const needsHandle = isPlaceholderHandle(me.handle);
  const suggested = needsHandle ? await suggestHandle(await getViewerEmail()) : '';
  const mine = projects.filter((project) => project.ownerHandle === me.handle);
  const shared = projects.filter((project) => project.ownerHandle !== me.handle);
  const [pending, deletedName] = await Promise.all([projects.length ? getNeedsYou(me, projects) : null, deleted ? deletedProjectName(deleted) : null]);

  return (
    <div className="page">
      <PageHead
        crumbs={[]}
        title="Your projects"
        actions={
          needsHandle ? (
            <button type="button" className="btn btn-primary" disabled title="Choose a handle first. Project addresses start with it.">
              <PlusIcon className="icon" />
              New project
            </button>
          ) : (
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
      {deleted && (
        <p className="notice" role="status">
          Deleted {deletedName ?? <span className="mono">{deleted}</span>}. You can restore it for 30 days, under <Link href="/settings#deleted">Account</Link>.
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
              <ProjectTable projects={shared} label="Shared with you" showRole />
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** The name of a project just deleted from this account, for the notice; the slug if it's not found. */
async function deletedProjectName(slug: string): Promise<string | null> {
  const deleted = await apiRequest<DeletedProject[]>(await requireAccessToken(), '/v1/me/deleted-projects').catch(() => []);
  return deleted.find((project) => project.slug === slug)?.name ?? null;
}

function ProjectTable({ projects, label, showRole }: { projects: Project[]; label: string; showRole: boolean }) {
  return (
    <table className="data-table" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">Project</th>
          {showRole && <th scope="col">Your role</th>}
          <th scope="col">Visibility</th>
          <th scope="col">Latest release</th>
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}
