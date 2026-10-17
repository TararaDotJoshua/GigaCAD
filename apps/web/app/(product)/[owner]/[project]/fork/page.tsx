import { isPlaceholderHandle } from '@gigacad/core';
import { redirect } from 'next/navigation';
import { forkProject, saveProfile } from '../../../actions';
import { ActionForm } from '../../../../../components/product/ActionForm';
import { EmptyState } from '../../../../../components/product/EmptyState';
import { HandleField } from '../../../../../components/product/HandleField';
import { PageHead } from '../../../../../components/product/PageHead';
import { releaseName } from '../../../../../lib/describe';
import { freeSlug, projectPath } from '../../../../../lib/paths';
import { getMyProjects, getProject, getReleases, getViewer, suggestHandle } from '../../../../../lib/product';
import { getViewerEmail } from '../../../../../lib/session';
import type { ProjectParams } from '../layout';

export async function generateMetadata({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project } = await params;
  return { title: `Fork · ${owner}/${project}` };
}

export default async function ForkPage({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project: slug } = await params;
  const [project, viewer] = await Promise.all([getProject(owner, slug), getViewer()]);
  if (!viewer) redirect(`/login?next=${encodeURIComponent(projectPath(owner, slug, 'fork'))}`);
  const crumbs = [{ label: owner, href: `/${owner}` }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Fork' }];
  if (project.visibility === 'private' && project.role !== 'owner' && project.role !== 'maintainer') {
    return (
      <div className="page page-narrow">
        <PageHead crumbs={crumbs} title={`Fork ${project.name}`} />
        <EmptyState title="Only maintainers can fork this project.">
          <p>A fork of a private project is a copy you keep, so the project’s owner and maintainers make them.</p>
        </EmptyState>
      </div>
    );
  }
  // A fork's address starts with your handle, so the placeholder one would make a link that breaks later.
  if (isPlaceholderHandle(viewer.handle)) {
    return (
      <div className="page page-narrow">
        <PageHead crumbs={crumbs} title={`Fork ${project.name}`} />
        <section className="card">
          <h2>Choose your handle first</h2>
          <p className="card-intro">Your fork’s address starts with it. You can change it later in Account settings.</p>
          <ActionForm action={saveProfile} submitLabel="Save handle" pendingLabel="Saving…" className="form form-inline">
            <HandleField defaultValue={await suggestHandle(await getViewerEmail())} />
          </ActionForm>
        </section>
      </div>
    );
  }
  const [releases, mine] = await Promise.all([getReleases(project.id), getMyProjects()]);
  // Forking into an address you already use would fail, so suggest the next free one.
  const suggested = freeSlug(project.slug, mine.filter((own) => own.ownerHandle === viewer.handle).map((own) => own.slug));
  const mustStayPrivate = project.visibility === 'private';
  return (
    <div className="page page-narrow">
      <PageHead crumbs={crumbs} title={`Fork ${project.name}`} />
      {releases.length === 0 ? (
        <EmptyState title="Nothing to fork yet.">
          <p>A fork starts from a release, and this project has none.</p>
        </EmptyState>
      ) : (
        <section className="section">
          <p className="section-intro">
            A fork copies one release into a new project you own, as its v1. Its history starts fresh, and its files count against your storage.
          </p>
          <ActionForm action={forkProject.bind(null, project.id)} submitLabel="Fork project" pendingLabel="Forking…">
            <label className="field">
              <span>Release</span>
              <select name="releaseNumber" defaultValue={releases[0]!.number}>
                {releases.map((release) => (
                  <option key={release.id} value={release.number}>
                    {releaseName(release)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Name</span>
              <input name="name" required maxLength={100} defaultValue={project.name} />
            </label>
            <label className="field">
              <span>Address</span>
              <span className="field-prefixed">
                <span className="mono muted">{viewer.handle}/</span>
                <input name="slug" required maxLength={100} pattern="[a-z0-9](?:[a-z0-9._\-]{0,98}[a-z0-9])?" defaultValue={suggested} className="mono" title="Lowercase letters, digits, dots, dashes, or underscores" spellCheck={false} />
              </span>
              <span className="field-hint">Part of the fork’s link. It can’t be changed later.</span>
            </label>
            <label className="field">
              <span>Visibility</span>
              <select name="visibility" defaultValue={project.visibility} disabled={mustStayPrivate}>
                <option value="public">Public: anyone can see and fork it</option>
                <option value="private">Private: only people you add</option>
              </select>
              {mustStayPrivate && <input type="hidden" name="visibility" value="private" />}
              {mustStayPrivate && <span className="field-hint">A fork of a private project stays private.</span>}
            </label>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
