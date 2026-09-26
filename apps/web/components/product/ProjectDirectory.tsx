import { formatBytes } from '@gigacad/core';
import Link from 'next/link';
import { createFolder, createTag, deleteTag, renameTag } from '../../app/(product)/actions';
import type { DirectoryFile, DirectoryItem, DirectoryListing, FilePage, Project, ProjectTag } from '../../lib/api';
import { BRANCH_STATUS_LABEL, branchTone } from '../../lib/describe';
import { exportFilename, isSolidWorks, previewFormat } from '../../lib/preview';
import { branchPath, entryPath, projectPath, releasePath, treePath } from '../../lib/paths';
import { getDirectory, getFileExports, getRootFolders, getTags, getThumbnails, searchFiles, type FileQuery } from '../../lib/product';
import { FolderIcon, LockIcon, SearchIcon } from '../icons';
import { ActionButton } from './ActionButton';
import { ActionForm } from './ActionForm';
import { DownloadButton } from './DownloadButton';
import { EntryMenu } from './EntryMenu';
import { EmptyState } from './EmptyState';
import { FavoriteButton } from './FavoriteButton';
import { FileGlyph } from './FileGlyph';
import { PreviewButton } from './PreviewButton';
import { RelativeTime } from './RelativeTime';
import { StatusBadge } from './StatusBadge';
import { TagPicker } from './TagPicker';
import { UploadFiles } from './UploadFiles';

const PAGE_SIZE = 100;

/** What the URL asks for: a folder, or a search, recent files, or favorites across the whole project. */
export interface DirectoryParams {
  q?: string;
  tags?: string;
  view?: string;
  sort?: string;
  order?: string;
  offset?: string;
}

type Sort = NonNullable<FileQuery['sort']>;

function readParams(params: DirectoryParams) {
  const q = (params.q ?? '').trim().slice(0, 200);
  const tagIds = (params.tags ?? '').split(',').filter((tag) => /^[0-9a-f-]{36}$/i.test(tag)).slice(0, 20);
  const view = params.view === 'recent' || params.view === 'favorites' ? params.view : null;
  const sort: Sort = params.sort === 'modified' || params.sort === 'size' ? params.sort : view === 'recent' ? 'modified' : 'name';
  const order: 'asc' | 'desc' | undefined = params.order === 'asc' || params.order === 'desc' ? params.order : undefined;
  const offset = Math.max(0, Math.floor(Number(params.offset) || 0));
  return { q, tagIds, view, sort, order, offset };
}

/**
 * The project directory: root files and folders beside the Branches and Releases folders.
 * With a search, a tag, or the Recent or Favorites view, it lists matching files from the
 * whole project instead, each with where it lives.
 */
export async function ProjectDirectory({ project, path, params, signedIn }: { project: Project; path: string; params: DirectoryParams; signedIn: boolean }) {
  const owner = project.ownerHandle;
  const slug = project.slug;
  const { q, tagIds, view, sort, order, offset } = readParams(params);
  const searching = Boolean(q || tagIds.length || view);
  const paging = { sort, order, offset, limit: PAGE_SIZE };

  const [listing, results, tags] = await Promise.all([
    searching ? null : getDirectory(project.id, path, paging),
    searching
      ? searchFiles(project.id, { ...paging, q, tags: tagIds.join(','), favorites: view === 'favorites' })
      : null,
    getTags(project.id),
  ]);
  const page: FilePage<DirectoryItem> = listing ?? results!;
  const canTag = project.role !== null && project.role !== 'viewer';
  const here = searching ? projectPath(owner, slug) : treePath(owner, slug, listing!.location.path);

  /** A link to this view with some parameters changed. */
  const href = (changes: Partial<Record<keyof DirectoryParams, string | undefined>>) => {
    const next = { q, tags: tagIds.join(','), view: view ?? '', sort: params.sort, order: params.order, offset: undefined, ...changes };
    const query = new URLSearchParams(Object.entries(next).flatMap(([key, value]) => (value ? [[key, value]] : [])));
    const base = next.q || next.tags || next.view ? projectPath(owner, slug) : here;
    return query.size ? `${base}?${query}` : base;
  };
  const tab = (value: 'recent' | 'favorites' | null, label: string) => (
    <Link
      href={value ? href({ view: value, q: undefined, tags: undefined, sort: undefined, order: undefined }) : projectPath(owner, slug)}
      className={`segment${view === value && (value || !searching) ? ' is-selected' : ''}`}
      aria-current={view === value && (value || !searching) ? 'page' : undefined}
    >
      {label}
    </Link>
  );
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));

  return (
    <div className="directory">
      <div className="toolbar directory-toolbar">
        <form action={projectPath(owner, slug)} className="app-search explore-search" role="search">
          <SearchIcon className="icon" />
          <label className="sr-only" htmlFor="directory-q">
            Search files in this project
          </label>
          <input id="directory-q" name="q" defaultValue={q} placeholder="Search files by name or path" />
          {tagIds.length > 0 && <input type="hidden" name="tags" value={tagIds.join(',')} />}
          {view && <input type="hidden" name="view" value={view} />}
        </form>
        <nav className="segmented interval-toggle" aria-label="Files view">
          {tab(null, 'All files')}
          {tab('recent', 'Recent')}
          {signedIn && tab('favorites', 'Favorites')}
        </nav>
      </div>

      {searching ? (
        <p className="toolbar-note directory-summary">
          {page.total} {page.total === 1 ? 'file' : 'files'}
          {view === 'favorites' ? ' in your favorites' : view === 'recent' ? ', most recently changed first' : ''}
          {q && <> matching “{q}”</>}
          {tagIds.length > 0 && (
            <>
              {' '}tagged{' '}
              {tagIds.map((tagId) => (
                <Link key={tagId} href={href({ tags: tagIds.filter((other) => other !== tagId).join(',') })} className="tag-chip is-removable" title="Remove this filter">
                  {tagNames.get(tagId) ?? 'a deleted tag'} ×
                </Link>
              ))}
            </>
          )}
          . <Link href={projectPath(owner, slug)}>Back to all files</Link>
        </p>
      ) : (
        <FolderBar project={project} listing={listing!} />
      )}

      {page.entries.length === 0 ? (
        <EmptyFolder searching={searching} view={view} listing={listing} />
      ) : (
        <DirectoryTable
          project={project}
          entries={page.entries}
          tags={tags}
          canTag={canTag}
          signedIn={signedIn}
          showLocation={searching}
          sortLink={(column) => {
            const active = sort === column;
            const current = order ?? (column === 'name' ? 'asc' : 'desc');
            return {
              href: href({ sort: column, order: active ? (current === 'asc' ? 'desc' : 'asc') : undefined }),
              active: active ? (current === 'asc' ? 'ascending' : 'descending') : undefined,
            };
          }}
          tagLink={(tagId) => href({ tags: [...new Set([...tagIds, tagId])].join(','), offset: undefined })}
        />
      )}

      {(offset > 0 || page.nextOffset !== null) && (
        <nav className="pager" aria-label="Pages">
          <span className="muted">
            {offset + 1}–{offset + page.entries.length} of {page.total}
          </span>
          {offset > 0 && (
            <Link className="btn btn-secondary btn-small" href={href({ offset: String(Math.max(0, offset - PAGE_SIZE)) })}>
              Previous
            </Link>
          )}
          {page.nextOffset !== null && (
            <Link className="btn btn-secondary btn-small" href={href({ offset: String(page.nextOffset) })}>
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

/** Breadcrumbs for the folder, what can be done here, and the branch or release it belongs to. */
function FolderBar({ project, listing }: { project: Project; listing: DirectoryListing }) {
  const owner = project.ownerHandle;
  const slug = project.slug;
  const { location } = listing;
  const existing = Object.fromEntries(
    listing.entries.flatMap((entry) => (entry.kind === 'file' && entry.entryId ? [[entry.name.toLowerCase(), entry.entryId]] : [])),
  );
  return (
    <div className="folder-bar">
      <nav className="app-crumbs folder-crumbs" aria-label="Folder">
        {location.crumbs.length === 0 ? (
          <span aria-current="page">{project.name}</span>
        ) : (
          <Link href={projectPath(owner, slug)}>{project.name}</Link>
        )}
        {location.crumbs.map((crumb, index) => (
          <span key={crumb.path}>
            <span className="crumb-sep"> / </span>
            {index === location.crumbs.length - 1 ? (
              <span aria-current="page" className={index > 0 ? 'mono' : undefined}>
                {crumb.name}
              </span>
            ) : (
              <Link href={treePath(owner, slug, crumb.path)} className={index > 0 ? 'mono' : undefined}>
                {crumb.name}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {location.writable && (
        <div className="folder-actions">
          <details className="menu">
            <summary className="btn btn-secondary btn-small">
              <FolderIcon className="icon" />
              New folder
            </summary>
            <div className="menu-list menu-form">
              <ActionForm action={createFolder.bind(null, project.id, location.folderId)} submitLabel="Create folder" submitClassName="btn btn-primary btn-small">
                <label className="field">
                  <span>Folder name</span>
                  <input name="name" required maxLength={255} autoComplete="off" />
                </label>
              </ActionForm>
            </div>
          </details>
          <UploadFiles projectId={project.id} parentId={location.folderId} existing={existing} />
        </div>
      )}

      {location.branch && (
        <p className="notice folder-notice">
          <StatusBadge tone={branchTone(location.branch.status)}>{BRANCH_STATUS_LABEL[location.branch.status]}</StatusBadge>{' '}
          {location.branch.checkedOutByHandle
            ? `Checked out by @${location.branch.checkedOutByHandle}${location.branch.checkedOutMachine ? ` on ${location.branch.checkedOutMachine}` : ''}. `
            : 'Nobody has this branch checked out. '}
          These are the files at the branch head. Change them by checking out the branch in the GigaCAD drive or with{' '}
          <code className="mono">giga checkout</code>. <Link href={branchPath(owner, slug, location.branch.name)}>Branch history</Link>
        </p>
      )}
      {location.release && (
        <p className="notice folder-notice">
          <LockIcon className="icon" /> v{location.release.number} is released and can’t change. Released <RelativeTime value={location.release.createdAt} />
          {location.release.createdByHandle && ` by @${location.release.createdByHandle}`}.{' '}
          <Link href={releasePath(owner, slug, location.release.number)}>Release notes</Link>
        </p>
      )}
    </div>
  );
}

function EmptyFolder({ searching, view, listing }: { searching: boolean; view: string | null; listing: DirectoryListing | null }) {
  if (searching) {
    return (
      <EmptyState title={view === 'favorites' ? 'No favorites yet.' : 'No files match.'}>
        {view === 'favorites' && <p>Star a file to keep it here. Favorites are yours alone.</p>}
      </EmptyState>
    );
  }
  const area = listing?.location.area;
  if (area === 'branches') return <EmptyState title="No branches yet." />;
  if (area === 'releases') return <EmptyState title="No releases yet." />;
  return (
    <EmptyState title="This folder is empty.">
      {listing?.location.writable && <p>Upload files or create a folder. Files here keep their own revisions, apart from branches and releases.</p>}
    </EmptyState>
  );
}

async function DirectoryTable({
  project,
  entries,
  tags,
  canTag,
  signedIn,
  showLocation,
  sortLink,
  tagLink,
}: {
  project: Project;
  entries: DirectoryItem[];
  tags: ProjectTag[];
  canTag: boolean;
  signedIn: boolean;
  showLocation: boolean;
  sortLink: (column: Sort) => { href: string; active: 'ascending' | 'descending' | undefined };
  tagLink: (tagId: string) => string;
}) {
  const owner = project.ownerHandle;
  const slug = project.slug;
  const files = entries.filter((entry): entry is DirectoryFile => entry.kind === 'file');
  // Contributors get a right-click menu on root files and folders.
  const editable = canTag && entries.some((entry) => entry.entryId);
  const [thumbnails, exports, folders] = await Promise.all([
    getThumbnails(project.id, files.filter((file) => previewFormat(file.name) || isSolidWorks(file.name)).map((file) => file.blob)),
    getFileExports(project.id, files.filter((file) => isSolidWorks(file.name)).map((file) => file.blob)),
    editable ? getRootFolders(project.id) : [],
  ]);
  const menuData = (entry: DirectoryItem): Record<string, string> =>
    editable && entry.entryId
      ? {
          'data-entry-id': entry.entryId,
          'data-entry-kind': entry.kind,
          'data-entry-name': entry.name,
          'data-entry-path': entry.path,
          'data-entry-href': entry.kind === 'folder' ? treePath(owner, slug, entry.path) : entryPath(owner, slug, entry.entryId),
        }
      : {};
  const header = (column: Sort, label: string) => {
    const link = sortLink(column);
    return (
      <th scope="col" aria-sort={link.active}>
        <Link href={link.href} className="sort-link">
          {label}
          {link.active && <span aria-hidden="true">{link.active === 'ascending' ? ' ↑' : ' ↓'}</span>}
        </Link>
      </th>
    );
  };

  const table = (
    <div className="table-wrap">
      <table className="data-table file-table directory-table">
        <thead>
          <tr>
            {header('name', 'Name')}
            {showLocation && <th scope="col">Location</th>}
            {header('modified', 'Modified')}
            {header('size', 'Size')}
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) =>
            entry.kind === 'folder' ? (
              <tr key={`folder:${entry.path}`} {...menuData(entry)}>
                <td>
                  <span className="file-cell">
                    <span className="file-glyph" aria-hidden="true">
                      {entry.virtual === 'release' ? <LockIcon className="icon" /> : <FolderIcon className="icon" />}
                    </span>
                    <Link href={treePath(owner, slug, entry.path)} className={entry.virtual === 'branches' || entry.virtual === 'releases' ? 'folder-name' : 'folder-name mono'}>
                      {entry.name}
                    </Link>
                    {entry.branch && (
                      <>
                        <StatusBadge tone={branchTone(entry.branch.status)}>{BRANCH_STATUS_LABEL[entry.branch.status]}</StatusBadge>
                        {entry.branch.checkedOutByHandle && (
                          <span className="muted lock-note" title={`Checked out by @${entry.branch.checkedOutByHandle}`}>
                            <LockIcon className="icon" />@{entry.branch.checkedOutByHandle}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </td>
                {showLocation && <td />}
                <td className="muted">
                  <RelativeTime value={entry.modifiedAt} />
                </td>
                <td />
                <td className="cell-action" />
              </tr>
            ) : (
              <FileRow
                key={`file:${entry.path}`}
                project={project}
                file={entry}
                tags={tags}
                canTag={canTag}
                signedIn={signedIn}
                showLocation={showLocation}
                thumbnailUrl={thumbnails[entry.blob]}
                fileExports={exports[entry.blob] ?? []}
                tagLink={tagLink}
                menuData={menuData(entry)}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
  if (!editable) return table;
  return (
    <EntryMenu projectId={project.id} folders={folders}>
      {table}
      <p className="muted entry-menu-hint">Right-click a file or folder to rename, move, or delete it.</p>
    </EntryMenu>
  );
}

function locationLabel(file: DirectoryFile): string {
  const folder = file.location.path.includes('/') ? file.location.path.slice(0, file.location.path.lastIndexOf('/')) : '';
  const area = file.location.area === 'branch' ? `Branches/${file.location.branchName}` : file.location.area === 'release' ? `Releases/v${file.location.releaseNumber}` : '';
  return [area, folder].filter(Boolean).join('/');
}

function FileRow({
  project,
  file,
  tags,
  canTag,
  signedIn,
  showLocation,
  thumbnailUrl,
  fileExports,
  tagLink,
  menuData,
}: {
  project: Project;
  file: DirectoryFile;
  tags: ProjectTag[];
  canTag: boolean;
  signedIn: boolean;
  showLocation: boolean;
  thumbnailUrl: string | undefined;
  fileExports: { format: 'stl' | 'step'; sha256: string }[];
  tagLink: (tagId: string) => string;
  menuData: Record<string, string>;
}) {
  const owner = project.ownerHandle;
  const slug = project.slug;
  const format = previewFormat(file.name);
  // A SolidWorks file previews from its STL export, or else its STEP export.
  const model = fileExports.find((entry) => entry.format === 'stl') ?? fileExports.find((entry) => entry.format === 'step');
  const folder = locationLabel(file);
  return (
    <tr {...menuData}>
      <td>
        <span className="file-cell">
          <FileGlyph path={file.name} thumbnailUrl={thumbnailUrl} />
          <span className="file-name-block">
            {file.entryId ? (
              <Link href={entryPath(owner, slug, file.entryId)} className="mono">
                {file.name}
              </Link>
            ) : (
              <span className="mono">{file.name}</span>
            )}
            {(file.tags.length > 0 || file.revision !== null) && (
              <span className="file-meta">
                {file.revision !== null && file.revision > 1 && <span className="muted">Revision {file.revision}</span>}
                {file.tags.map((tag) => (
                  <Link key={tag.id} href={tagLink(tag.id)} className="tag-chip">
                    {tag.name}
                  </Link>
                ))}
              </span>
            )}
          </span>
        </span>
      </td>
      {showLocation && (
        <td>
          <Link href={treePath(owner, slug, folder)} className="mono muted location-link">
            {folder || project.name}
          </Link>
        </td>
      )}
      <td className="muted">
        <RelativeTime value={file.modifiedAt} />
        {file.modifiedByHandle && <span className="modified-by"> by @{file.modifiedByHandle}</span>}
      </td>
      <td className="muted nowrap">{formatBytes(file.size)}</td>
      <td className="cell-action">
        {format ? (
          <PreviewButton projectId={project.id} sha256={file.blob} path={file.name} format={format} />
        ) : (
          model && <PreviewButton projectId={project.id} sha256={model.sha256} path={file.name} format={model.format} />
        )}
        {fileExports.map((entry) => (
          <DownloadButton
            key={entry.format}
            projectId={project.id}
            sha256={entry.sha256}
            path={file.name}
            filename={exportFilename(file.name, entry.format)}
            label={entry.format.toUpperCase()}
          />
        ))}
        <DownloadButton projectId={project.id} sha256={file.blob} path={file.name} />
        {signedIn && <FavoriteButton projectId={project.id} itemId={file.itemId} favorite={file.favorite} name={file.name} />}
        {canTag && <TagPicker key={file.tags.map((tag) => tag.id).join()} projectId={project.id} itemId={file.itemId} name={file.name} tags={tags} selected={file.tags} />}
      </td>
    </tr>
  );
}

/** The project's tags, as filters, and for contributors a way to add, rename, and remove them. */
export function TagsCard({ project, tags }: { project: Project; tags: ProjectTag[] }) {
  const canManage = project.role !== null && project.role !== 'viewer';
  return (
    <section className="side tags-card" aria-label="Tags">
      <h2 className="side-heading">Tags</h2>
      {tags.length === 0 ? (
        <p className="muted">{canManage ? 'No tags yet. Add one, then tag files from their rows.' : 'No tags yet.'}</p>
      ) : (
        <ul className="tag-list">
          {tags.map((tag) => (
            <li key={tag.id}>
              <Link href={`${projectPath(project.ownerHandle, project.slug)}?tags=${tag.id}`} className="tag-chip">
                {tag.name}
              </Link>
              <span className="muted">{tag.fileCount}</span>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <details className="manage-tags">
          <summary>Manage tags</summary>
          <ActionForm action={createTag.bind(null, project.id)} submitLabel="Add tag" submitClassName="btn btn-secondary btn-small" className="form form-inline">
            <label className="field">
              <span className="sr-only">New tag</span>
              <input name="name" required maxLength={50} placeholder="New tag" autoComplete="off" />
            </label>
          </ActionForm>
          {tags.map((tag) => (
            <div key={tag.id} className="manage-tag">
              <ActionForm action={renameTag.bind(null, project.id, tag.id)} submitLabel="Rename" submitClassName="btn btn-secondary btn-small" className="form form-inline">
                <label className="field">
                  <span className="sr-only">Name for {tag.name}</span>
                  <input name="name" required maxLength={50} defaultValue={tag.name} autoComplete="off" />
                </label>
              </ActionForm>
              <ActionButton
                action={deleteTag.bind(null, project.id, tag.id)}
                className="btn btn-danger btn-small"
                confirm={`Delete the tag ${tag.name}? It comes off ${tag.fileCount} ${tag.fileCount === 1 ? 'file' : 'files'}.`}
              >
                Delete
              </ActionButton>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
