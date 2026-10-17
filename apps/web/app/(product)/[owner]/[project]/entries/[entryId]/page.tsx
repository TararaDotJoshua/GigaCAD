import { formatBytes } from '@gigacad/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteEntry, moveEntry, replaceRootFile } from '../../../../actions';
import { ActionButton } from '../../../../../../components/product/ActionButton';
import { ActionForm } from '../../../../../../components/product/ActionForm';
import { DownloadButton } from '../../../../../../components/product/DownloadButton';
import { EntryContent } from '../../../../../../components/product/EntryContent';
import { FavoriteButton } from '../../../../../../components/product/FavoriteButton';
import { FileActions } from '../../../../../../components/product/FileActions';
import { FileGlyph } from '../../../../../../components/product/FileGlyph';
import { PageHead } from '../../../../../../components/product/PageHead';
import { ProblemPanel } from '../../../../../../components/product/ProblemPanel';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { TagPicker } from '../../../../../../components/product/TagPicker';
import { ReplaceFile } from '../../../../../../components/product/UploadFiles';
import type { FileExport, Project } from '../../../../../../lib/api';
import { dashboardPath } from '../../../../../../lib/hosts';
import { hasModel } from '../../../../../../lib/models';
import { isSolidWorks } from '../../../../../../lib/preview';
import { projectPath, treePath } from '../../../../../../lib/paths';
import { findEntry, getEntry, getEvents, getFileExports, getProject, getRootFolders, getTags, getThumbnails, getViewer } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

type EntryParams = ProjectParams & { entryId: string };

export async function generateMetadata({ params }: { params: Promise<EntryParams> }) {
  const { owner, project: slug, entryId } = await params;
  // A missing entry 404s from the page itself. Throwing here would stream the error after a 200.
  const entry = await getProject(owner, slug)
    .then((project) => getEntry(project.id, entryId))
    .then((detail) => detail.entry)
    .catch(() => null);
  if (!entry) return { title: 'Not found' };
  return { title: `${entry.name} · ${owner}/${slug}` };
}

/** A file or folder at the project root: its revisions and tags, and renaming, moving, and deleting it. */
export default async function EntryPage({ params }: { params: Promise<EntryParams> }) {
  const { owner, project: slug, entryId } = await params;
  const project = await getProject(owner, slug);
  const detail = await findEntry(project.id, entryId);
  if (!detail) return <DeletedEntry project={project} entryId={entryId} />;
  const [tags, folders, viewer] = await Promise.all([getTags(project.id), getRootFolders(project.id), getViewer()]);
  const { entry, revisions, writable } = detail;
  const segments = entry.path.split('/');
  const parentPath = segments.slice(0, -1).join('/');
  // A folder can't move into itself or anything inside it.
  const destinations = folders.filter((folder) => entry.kind === 'file' || (folder.id !== entry.id && !folder.path.toLowerCase().startsWith(`${entry.path.toLowerCase()}/`)));
  // A SolidWorks part previews and downloads through its exports, as it does in the file list.
  const blob = entry.blob;
  const [exports, thumbnails] =
    blob && hasModel(entry.name)
      ? await Promise.all([isSolidWorks(entry.name) ? getFileExports(project.id, [blob]) : Promise.resolve<Record<string, FileExport[]>>({}), getThumbnails(project.id, [blob])])
      : [{}, {}];

  return (
    <div className="page">
      <PageHead
        crumbs={[
          { label: owner, href: `/${owner}` },
          { label: project.name, href: projectPath(owner, slug) },
          ...segments.slice(0, -1).map((name, index) => ({ label: name, href: treePath(owner, slug, segments.slice(0, index + 1).join('/')), mono: true })),
          { label: entry.name, mono: true },
        ]}
        title={
          <span className="entry-title">
            {entry.kind === 'file' && <FileGlyph path={entry.name} thumbnailUrl={entry.blob ? thumbnails[entry.blob] : undefined} />}
            <span className="mono">{entry.name}</span>
          </span>
        }
        meta={
          <>
            <span>{entry.kind === 'folder' ? 'Folder' : `Revision ${entry.revision}`}</span>
            <span>
              In{' '}
              <Link href={treePath(owner, slug, parentPath)} className={parentPath ? 'mono' : undefined}>
                {parentPath || 'the project root'}
              </Link>
            </span>
            {detail.tags.map((tag) => (
              <Link key={tag.id} href={`${projectPath(owner, slug)}?tags=${tag.id}`} className="tag-chip">
                {tag.name}
              </Link>
            ))}
          </>
        }
        actions={
          entry.kind === 'folder' ? (
            <Link href={treePath(owner, slug, entry.path)} className="btn btn-secondary">
              Open folder
            </Link>
          ) : (
            <span className="action">
              {viewer && entry.itemId && <FavoriteButton projectId={project.id} itemId={entry.itemId} favorite={detail.favorite} name={entry.name} />}
              {writable && entry.itemId && <TagPicker projectId={project.id} itemId={entry.itemId} name={entry.name} tags={tags} selected={detail.tags} />}
              {entry.blob && <FileActions projectId={project.id} path={entry.name} blob={entry.blob} size={revisions[0]?.size} exports={exports[entry.blob] ?? []} />}
            </span>
          )
        }
      />
      <div className="page-grid">
        <div className="stack">
          {entry.kind === 'file' && entry.blob && revisions[0] && <EntryContent project={project} name={entry.name} blob={entry.blob} size={revisions[0].size} />}
          {entry.kind === 'file' && (
            <section className="section">
              <h2>Revisions</h2>
              <p className="section-intro">
                Files uploaded to the project keep a numbered revision for every upload or replacement. Renaming or moving doesn’t make one. Branches and
                releases keep their own versions, separate from these.
              </p>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Revision</th>
                      <th scope="col">Saved</th>
                      <th scope="col">Size</th>
                      <th scope="col">
                        <span className="sr-only">Download</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {revisions.map((revision) => (
                      <tr key={revision.number}>
                        <td>
                          {revision.number}
                          {revision.number === entry.revision && <span className="muted"> · current</span>}
                        </td>
                        <td className="muted">
                          <RelativeTime value={revision.createdAt} />
                          {revision.authorHandle && ` by @${revision.authorHandle}`}
                        </td>
                        <td className="muted">{formatBytes(revision.size)}</td>
                        <td className="cell-action">
                          {writable && revision.number !== entry.revision && revision.blob !== entry.blob && (
                            <ActionButton
                              action={replaceRootFile.bind(null, project.id, entry.id, revision.blob, entry.revision)}
                              className="btn btn-secondary btn-small"
                              confirm={`Make revision ${revision.number} current? It’s saved as revision ${(entry.revision ?? 0) + 1}; nothing is lost.`}
                              pendingLabel="Saving…"
                            >
                              Make current
                            </ActionButton>
                          )}
                          <DownloadButton projectId={project.id} sha256={revision.blob} path={entry.name} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
        {writable && (
          <aside className="request-rail">
            {entry.kind === 'file' && (
              <section className="rail-card">
                <h2>Replace</h2>
                <p className="muted">Upload new contents. They become revision {(entry.revision ?? 0) + 1}.</p>
                <ReplaceFile projectId={project.id} entryId={entry.id} name={entry.name} revision={entry.revision} owner={{ handle: project.ownerHandle, isYou: viewer?.handle === project.ownerHandle }} />
              </section>
            )}
            <details className="rail-card rail-details">
              <summary>
                <h2>Rename or move</h2>
              </summary>
              {/* Remounts with the saved name and folder, so the form never shows (and resends) old ones. */}
              <ActionForm action={moveEntry.bind(null, project.id, entry.id)} submitLabel="Save" fieldsKey={`${entry.name}/${entry.parentId ?? ''}`}>
                <input type="hidden" name="wasName" value={entry.name} />
                <input type="hidden" name="wasParentId" value={entry.parentId ?? ''} />
                <label className="field">
                  <span>Name</span>
                  <input name="name" required maxLength={255} defaultValue={entry.name} autoComplete="off" />
                </label>
                <label className="field">
                  <span>Folder</span>
                  <select name="parentId" defaultValue={entry.parentId ?? ''}>
                    <option value="">Project root</option>
                    {destinations.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.path}
                      </option>
                    ))}
                  </select>
                </label>
              </ActionForm>
            </details>
            <section className="rail-card">
              <h2>Delete</h2>
              <p className="muted">
                {entry.kind === 'folder'
                  ? 'Deletes the folder and everything in it, with every revision.'
                  : 'Deletes the file and every revision. Branches and releases keep their own files.'}
              </p>
              <ActionButton
                action={deleteEntry.bind(null, project.id, entry.id, owner, slug, parentPath, entry.name)}
                className="btn btn-danger"
                confirm={`Delete ${entry.path}${entry.kind === 'folder' ? ' and everything in it' : ''}? This can’t be undone.`}
              >
                Delete {entry.kind}
              </ActionButton>
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}

/**
 * A root file or folder that isn't there anymore. If the project's feed says it was deleted, say
 * so and link to the folder it was in, instead of a bare not-found page.
 */
async function DeletedEntry({ project, entryId }: { project: Project; entryId: string }) {
  const events = await getEvents(project.id, 200).catch(() => []);
  const deleted = events.find((event) => event.kind === 'directory_entry_deleted' && event.subjectId === entryId);
  const path = typeof deleted?.payload?.path === 'string' ? deleted.payload.path : null;
  if (!deleted || path === null) notFound();
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const owner = project.ownerHandle;
  return (
    <ProblemPanel
      title={deleted.payload?.kind === 'folder' ? 'This folder was deleted' : 'This file was deleted'}
      home={dashboardPath()}
      action={
        <Link href={treePath(owner, project.slug, parent)} className="btn btn-primary">
          {parent ? `Open ${parent.split('/').pop()}` : `Back to ${project.name}`}
        </Link>
      }
    >
      <p>
        <span className="mono">{path}</span> was deleted <RelativeTime value={deleted.createdAt} />. Branches and releases keep their own copies of their files.
      </p>
    </ProblemPanel>
  );
}

