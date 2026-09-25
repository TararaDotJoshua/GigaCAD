import { isPlaceholderHandle } from '@gigacad/core';
import Link from 'next/link';
import { saveProfile } from '../../actions';
import { ActionForm } from '../../../../components/product/ActionForm';
import { EmptyState } from '../../../../components/product/EmptyState';
import { HandleField } from '../../../../components/product/HandleField';
import { PageHead } from '../../../../components/product/PageHead';
import { PlusIcon } from '../../../../components/icons';
import { getMe, getMyProjects } from '../../../../lib/product';
import { projectPath } from '../../../../lib/paths';

export const metadata = { title: 'Your projects' };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ device?: string }> }) {
  const [me, projects, { device }] = await Promise.all([getMe(), getMyProjects(), searchParams]);
  const needsHandle = isPlaceholderHandle(me.handle);

  return (
    <div className="page">
      <PageHead
        crumbs={[{ label: 'GigaCAD' }]}
        title="Your projects."
        actions={
          !needsHandle && (
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

      {needsHandle && (
        <section className="card">
          <h2>Choose your handle.</h2>
          <p className="card-intro">It appears in your project addresses and next to everything you do.</p>
          <ActionForm action={saveProfile} submitLabel="Save handle" className="form form-inline">
            <HandleField defaultValue="" />
          </ActionForm>
        </section>
      )}

      {projects.length === 0 ? (
        !needsHandle && (
          <EmptyState title="No projects yet.">
            <p>A project holds your CAD files, their branches, and every release.</p>
            <Link href="/new" className="btn btn-secondary">
              Create a project
            </Link>
          </EmptyState>
        )
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Your role</th>
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
                <td className="muted role">{project.role ?? 'viewer'}</td>
                <td className="muted">{project.visibility === 'public' ? 'Public' : 'Private'}</td>
                <td className="mono">{project.latestReleaseNumber ? `v${project.latestReleaseNumber}` : <span className="muted">None yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
