import { redirect } from 'next/navigation';
import { forkProject } from '../../../actions';
import { ActionForm } from '../../../../../components/product/ActionForm';
import { EmptyState } from '../../../../../components/product/EmptyState';
import { PageHead } from '../../../../../components/product/PageHead';
import { projectPath } from '../../../../../lib/paths';
import { getProject, getReleases, getViewer } from '../../../../../lib/product';
import type { ProjectParams } from '../layout';

export const metadata = { title: 'Fork' };

export default async function ForkPage({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project: slug } = await params;
  const [project, viewer] = await Promise.all([getProject(owner, slug), getViewer()]);
  if (!viewer) redirect(`/login?next=${encodeURIComponent(projectPath(owner, slug, 'fork'))}`);
  const releases = await getReleases(project.id);
  const mustStayPrivate = project.visibility === 'private';
  return (
    <div className="page page-narrow">
      <PageHead crumbs={[{ label: owner }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Fork' }]} title={`Fork ${project.name}.`} />
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
                    v{release.number}
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
                <input name="slug" required maxLength={100} pattern="[a-z0-9](?:[a-z0-9._\-]{0,98}[a-z0-9])?" defaultValue={project.slug} className="mono" title="Lowercase letters, digits, dots, dashes, or underscores" spellCheck={false} />
              </span>
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
