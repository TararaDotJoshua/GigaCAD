import { formatBytes } from '@gigacad/core';
import Link from 'next/link';
import { deleteEntry, moveEntry } from '../../../../actions';
import { ActionButton } from '../../../../../../components/product/ActionButton';
import { ActionForm } from '../../../../../../components/product/ActionForm';
import { DownloadButton } from '../../../../../../components/product/DownloadButton';
import { FavoriteButton } from '../../../../../../components/product/FavoriteButton';
import { PageHead } from '../../../../../../components/product/PageHead';
import { PreviewButton } from '../../../../../../components/product/PreviewButton';
import { RelativeTime } from '../../../../../../components/product/RelativeTime';
import { TagPicker } from '../../../../../../components/product/TagPicker';
import { ReplaceFile } from '../../../../../../components/product/UploadFiles';
import { previewFormat } from '../../../../../../lib/preview';
import { projectPath, treePath } from '../../../../../../lib/paths';
import { getEntry, getProject, getRootFolders, getTags, getViewer } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';

type EntryParams = ProjectParams & { entryId: string };

export async function generateMetadata({ params }: { params: Promise<EntryParams> }) {
  const { owner, project } = await params;
  return { title: `${owner}/${project}` };
}

/** A file or folder at the project root: its revisions and tags, and renaming, moving, and deleting it. */
export default async function EntryPage({ params }: { params: Promise<EntryParams> }) {
  const { owner, project: slug, entryId } = await params;
  const project = await getProject(owner, slug);
  const [detail, tags, folders, viewer] = await Promise.all([getEntry(project.id, entryId), getTags(project.id), getRootFolders(project.id), getViewer()]);
  const { entry, revisions, writable } = detail;
  const segments = entry.path.split('/');
  const parentPath = segments.slice(0, -1).join('/');
  // A folder can't move into itself or anything inside it.
  const destinations = folders.filter((folder) => entry.kind === 'file' || (folder.id !== entry.id && !folder.path.toLowerCase().startsWith(`${entry.path.toLowerCase()}/`)));
  const format = previewFormat(entry.name);

  return (
    <div className="page">
      <PageHead
        crumbs={[
          { label: owner },
          { label: project.name, href: projectPath(owner, slug) },
          ...segments.slice(0, -1).map((name, index) => ({ label: name, href: treePath(owner, slug, segments.slice(0, index + 1).join('/')) })),
          { label: entry.name },
        ]}
        title={<span className="mono">{entry.name}</span>}
        meta={
          <>
            <span>{entry.kind === 'folder' ? 'Folder' : `Revision ${entry.revision}`}</span>
            <span>
              In <Link href={treePath(owner, slug, parentPath)}>{parentPath || 'the project root'}</Link>
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
              {format && entry.blob && <PreviewButton projectId={project.id} sha256={entry.blob} path={entry.name} format={format} />}
              {viewer && entry.itemId && <FavoriteButton projectId={project.id} itemId={entry.itemId} favorite={detail.favorite} name={entry.name} />}
              {writable && entry.itemId && <TagPicker projectId={project.id} itemId={entry.itemId} name={entry.name} tags={tags} selected={detail.tags} />}
              {entry.blob && <DownloadButton projectId={project.id} sha256={entry.blob} path={entry.name} />}
            </span>
          )
        }
      />
      <div className="page-grid">
        <div className="stack">
          {entry.kind === 'file' && (
            <section className="section">
              <h2>Revisions</h2>
              <p className="section-intro">
                Each upload or replacement of this file is kept. Renaming or moving it doesn’t make a revision. Root files are separate from branches and
                releases.
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
                <ReplaceFile projectId={project.id} entryId={entry.id} name={entry.name} />
              </section>
            )}
            <section className="rail-card">
              <h2>Rename or move</h2>
              <ActionForm action={moveEntry.bind(null, project.id, entry.id)} submitLabel="Save">
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
            </section>
            <section className="rail-card">
              <h2>Delete</h2>
              <p className="muted">
                {entry.kind === 'folder'
                  ? 'Deletes the folder and everything in it, with every revision.'
                  : 'Deletes the file and every revision. Branches and releases keep their own files.'}
              </p>
              <ActionButton
                action={deleteEntry.bind(null, project.id, entry.id, owner, slug, parentPath)}
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
