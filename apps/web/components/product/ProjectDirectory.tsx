import { formatBytes } from '@gigacad/core';
import Form from 'next/form';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createTag } from '../../app/(product)/actions';
import type { DirectoryFile, DirectoryItem, DirectoryListing, FileExport, FilePage, Project, ProjectTag } from '../../lib/api';
import { BRANCH_STATUS_LABEL, branchTone } from '../../lib/describe';
import { pager } from '../../lib/directory';
import { hasModel } from '../../lib/models';
import { isSolidWorks } from '../../lib/preview';
import { branchPath, entryPath, projectPath, releasePath, treePath } from '../../lib/paths';
import { getBilling, getDirectory, getEvents, getFileExports, getReadme, getRootFolders, getTags, getThumbnailLinks, getViewer, searchFiles, type FileQuery } from '../../lib/product';
import { BranchIcon, FolderIcon, LockIcon, MoreIcon, SearchIcon } from '../icons';
import { ActionForm } from './ActionForm';
import { DropZone } from './DropZone';
import { EntryMenu } from './EntryMenu';
import { EmptyState } from './EmptyState';
import { FavoriteButton } from './FavoriteButton';
import { FileActions } from './FileActions';
import { FileGlyph } from './FileGlyph';
import { GettingStarted } from './GettingStarted';
import { IntentLink } from './IntentLink';
import { ManageTag } from './ManageTag';
import { NewFolderMenu } from './NewFolderMenu';
import { ProjectReadme } from './ProjectReadme';
import { RefreshSoon } from './RefreshSoon';
import { RelativeTime } from './RelativeTime';
import { StatusBadge } from './StatusBadge';
import { TagPicker } from './TagPicker';
import { UploadFiles } from './UploadFiles';

const PAGE_SIZE = 100;

/** The page of a folder the URL asks for, as getDirectory takes it. The tab title reads the same page, so they share one request. */
export function directoryPaging(params: DirectoryParams) {
  const { sort, order, offset } = readParams(params);
  return { sort, order, offset, limit: PAGE_SIZE };
}

/** What the URL asks for: a folder, or a search, recent files, or favorites across the whole project. */
export interface DirectoryParams {
  q?: string;
  tags?: string;
  view?: string;
  sort?: string;
  order?: string;
  offset?: string;
  /** Search inside this folder only. */
  under?: string;
  /** `released` shows released and archived branches in the Branches folder, and in search, tags, and favorites. */
  show?: string;
  /** The id of a file or folder just deleted from its own page, to say so here. */
  deleted?: string;
}

type Sort = NonNullable<FileQuery['sort']>;

function readParams(params: DirectoryParams) {
  const q = (params.q ?? '').trim().slice(0, 200);
  const tagIds = (params.tags ?? '').split(',').filter((tag) => /^[0-9a-f-]{36}$/i.test(tag)).slice(0, 20);
  const view = params.view === 'recent' || params.view === 'favorites' ? params.view : null;
  const sort: Sort = params.sort === 'modified' || params.sort === 'size' ? params.sort : view === 'recent' ? 'modified' : 'name';
  const order: 'asc' | 'desc' | undefined = params.order === 'asc' || params.order === 'desc' ? params.order : undefined;
  const offset = Math.max(0, Math.floor(Number(params.offset) || 0));
  const under = (params.under ?? '').trim().replace(/^\/+|\/+$/g, '').slice(0, 1024);
  return { q, tagIds, view, sort, order, offset, under, showReleased: params.show === 'released' };
}

/**
 * The project directory: root files and folders beside the Branches and Releases folders.
 * With a search, a tag, or the Recent or Favorites view, it lists matching files from the
 * whole project instead, each with where it lives.
 */
export async function ProjectDirectory({
  project,
  path,
  params,
  signedIn,
  viewerHandle,
  counts,
  embedded = false,
  basePath,
}: {
  project: Project;
  path: string;
  params: DirectoryParams;
  signedIn: boolean;
  viewerHandle: string | null;
  /** Shown on the Branches and Releases rows at the root, so those rows aren't blank. */
  counts?: { branches: number; releases: number };
  /** Inside another page (a branch or release page) that has its own heading: just the files. */
  embedded?: boolean;
  /** The page an embedded listing sits on, so sorting and paging stay there instead of opening the folder. */
  basePath?: string;
}) {
  const owner = project.ownerHandle;
  const slug = project.slug;
  const { q, tagIds, view, sort, order, offset, under, showReleased } = readParams(params);
  const searching = Boolean(q || tagIds.length || view);
  const paging = directoryPaging(params);

  const [listing, results, tags] = await Promise.all([
    searching ? null : getDirectory(project.id, path, paging),
    searching
      ? searchFiles(project.id, { ...paging, q, tags: tagIds.join(','), favorites: view === 'favorites', under: view ? undefined : under, history: showReleased })
      : null,
    getTags(project.id),
  ]);
  const listed: FilePage<DirectoryItem> = listing ?? results!;
  // Released and archived branches are history; the Branches folder shows them only on request.
  const hiddenBranches = listing?.location.area === 'branches' && !showReleased
    ? listing.entries.filter((entry) => entry.kind === 'folder' && (entry.branch?.status === 'released' || entry.branch?.status === 'archived')).length
    : 0;
  const page: FilePage<DirectoryItem> = hiddenBranches
    ? { ...listed, entries: listed.entries.filter((entry) => !(entry.kind === 'folder' && (entry.branch?.status === 'released' || entry.branch?.status === 'archived'))) }
    : listed;
  // The project root shows its README.md or README.txt under the files.
  const readme =
    listing && listing.location.area === 'root' && listing.location.path === ''
      ? await getReadme(project.id, listing.entries, offset === 0 && listing.nextOffset === null)
      : null;
  const canTag = project.role !== null && project.role !== 'viewer';
  const here = basePath ?? (searching ? projectPath(owner, slug) : treePath(owner, slug, listing!.location.path));

  /** A link to this view with some parameters changed. */
  const href = (changes: Partial<Record<keyof DirectoryParams, string | undefined>>) => {
    const next = { q, tags: tagIds.join(','), view: view ?? '', under: q || tagIds.length ? under : undefined, sort: params.sort, order: params.order, show: params.show, offset: undefined, ...changes };
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
  // Searching from inside a folder searches that folder, until you widen it.
  const scope = searching ? (q || tagIds.length ? under : '') : (listing?.location.path ?? '');
  const writable = !searching && Boolean(listing?.location.writable);
  const storageOwner = { handle: owner, isYou: viewerHandle === owner };
  // The root's Branches and Releases folders sit above the first page; they aren't files to count.
  const shown = page.entries.filter((entry) => !(entry.kind === 'folder' && (entry.virtual === 'branches' || entry.virtual === 'releases'))).length;
  const pages = pager({ offset, shown, total: page.total, pageSize: PAGE_SIZE, nextOffset: page.nextOffset });
  // Past the last page, as after deleting the last rows of it: go to the last page there is.
  if (shown === 0 && pages.last !== null) redirect(href({ offset: pages.last ? String(pages.last) : undefined }));
  const destination = listing?.location.path ? listing.location.path.split('/').pop()! : project.name;

  const directory = (
    <div className="directory">
      {!embedded && (
      <div className="toolbar directory-toolbar">
        <Form action={projectPath(owner, slug)} className="app-search explore-search" role="search">
          <SearchIcon className="icon" />
          <label className="sr-only" htmlFor="directory-q">
            Search files in this project
          </label>
          <input id="directory-q" name="q" defaultValue={q} placeholder={scope ? `Search in ${scope.split('/').pop()}` : 'Search files by name or path'} />
          {scope && <input type="hidden" name="under" value={scope} />}
          {tagIds.length > 0 && <input type="hidden" name="tags" value={tagIds.join(',')} />}
          {view && <input type="hidden" name="view" value={view} />}
        </Form>
        <nav className="segmented interval-toggle" aria-label="Files view">
          {tab(null, 'All files')}
          {tab('recent', 'Recent')}
          {signedIn && tab('favorites', 'Favorites')}
        </nav>
      </div>
      )}

      {searching ? (
        <p className="toolbar-note directory-summary">
          <span>
            {page.total} {page.total === 1 ? 'file' : 'files'}
            {view === 'favorites' ? ' in your favorites' : view === 'recent' ? ', most recently changed first' : ''}
            {q && <> matching “{q}”</>}
            {under && (q || tagIds.length > 0) && (
              <>
                {' '}in <span className="mono">{under}</span> (<Link href={href({ under: undefined })}>search the whole project</Link>)
              </>
            )}
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
          </span>
          <Link href={href({ show: showReleased ? undefined : 'released' })}>
            {showReleased ? 'Hide released and archived branches' : 'Include released and archived branches'}
          </Link>
          <Link href={projectPath(owner, slug)}>
            Back to all files
          </Link>
        </p>
      ) : (
        !embedded && <FolderBar project={project} listing={listing!} owner={storageOwner} />
      )}

      {params.deleted && !searching && <DeletedNotice projectId={project.id} entryId={params.deleted} />}

      {/* A brand-new project: nothing at the root but the two built-in folders, and no releases. */}
      {writable && listing?.location.path === '' && counts?.releases === 0 && !listing.entries.some((entry) => !(entry.kind === 'folder' && entry.virtual)) && (
        <GettingStarted project={`${owner}/${slug}`} />
      )}

      {page.entries.length === 0 ? (
        <EmptyFolder searching={searching} view={view} listing={listing} hiddenBranches={hiddenBranches} newBranch={canTag ? projectPath(owner, slug, 'branches') : null} />
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
          counts={counts}
        />
      )}

      {hiddenBranches > 0 && (
        <p className="toolbar-note">
          {hiddenBranches} released or archived {hiddenBranches === 1 ? 'branch is' : 'branches are'} hidden. <Link href={href({ show: 'released' })}>Show them</Link>
        </p>
      )}

      {(offset > 0 || page.nextOffset !== null) && (
        <nav className="pager" aria-label="Pages">
          {pages.label && <span className="muted">{pages.label}</span>}
          {pages.previous !== null && (
            <Link className="btn btn-secondary btn-small" href={href({ offset: pages.previous ? String(pages.previous) : undefined })} prefetch={false}>
              Previous
            </Link>
          )}
          {pages.next !== null && (
            <Link className="btn btn-secondary btn-small" href={href({ offset: String(pages.next) })} prefetch={false}>
              Next
            </Link>
          )}
        </nav>
      )}

      {readme && <ProjectReadme project={project} readme={readme} />}
    </div>
  );
  // Files dropped anywhere on a writable folder, its README and getting-started card included, upload here.
  return writable ? <DropZone destination={destination}>{directory}</DropZone> : directory;
}

/** Breadcrumbs for the folder, what can be done here, and the branch or release it belongs to. */
async function FolderBar({ project, listing, owner: storageOwner }: { project: Project; listing: DirectoryListing; owner: { handle: string; isYou: boolean } }) {
  const owner = project.ownerHandle;
  const slug = project.slug;
  const { location } = listing;
  const existing = Object.fromEntries(
    listing.entries.flatMap((entry) => (entry.kind === 'file' && entry.entryId ? [[entry.name.toLowerCase(), entry.entryId]] : [])),
  );
  // Your own storage is the only one you can see; it's already loaded for the shell's banner.
  const storageFull =
    location.writable && storageOwner.isYou ? await getBilling().then((billing) => billing.quotaBytes > 0 && billing.usedBytes >= billing.quotaBytes, () => false) : false;
  // The built-in Branches and Releases folders read as words; real folder, branch, and release names are mono.
  const builtIn = location.area !== 'root';
  return (
    <div className="folder-bar">
      {/* At the root, the page heading already names the project. */}
      {location.crumbs.length > 0 && (
      <nav className="app-crumbs folder-crumbs" aria-label="Folder">
        <Link href={projectPath(owner, slug)}>{project.name}</Link>
        {location.crumbs.map((crumb, index) => (
          <span key={crumb.path}>
            <span className="crumb-sep"> / </span>
            {index === location.crumbs.length - 1 ? (
              <span aria-current="page" className={builtIn && index === 0 ? undefined : 'mono'}>
                {crumb.name}
              </span>
            ) : (
              <Link href={treePath(owner, slug, crumb.path)} className={builtIn && index === 0 ? undefined : 'mono'}>
                {crumb.name}
              </Link>
            )}
          </span>
        ))}
      </nav>
      )}

      {location.writable && (
        <div className="folder-actions">
          <NewFolderMenu projectId={project.id} folderId={location.folderId} />
          <UploadFiles projectId={project.id} parentId={location.folderId} folderPath={location.path} existing={existing} owner={storageOwner} storageFull={storageFull} />
        </div>
      )}

      {location.branch && (
        <p className="notice folder-notice">
          <StatusBadge tone={branchTone(location.branch.status)}>{BRANCH_STATUS_LABEL[location.branch.status]}</StatusBadge>{' '}
          {location.branch.checkedOutByHandle
            ? `Checked out by @${location.branch.checkedOutByHandle}${location.branch.checkedOutMachine ? ` on ${location.branch.checkedOutMachine}` : ''}. `
            : 'No one has this branch checked out. '}
          These are the files at the branch head. Change them by checking out the branch with{' '}
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

/** How long after a delete its folder still says so. */
const DELETED_NOTICE_MS = 10 * 60 * 1000;

/**
 * "Deleted X", after deleting a file or folder from its own page. The address names only the
 * entry; the notice shows when the project's feed says the viewer deleted it moments ago, so a
 * link someone crafts can't make a folder announce something that didn't happen.
 */
async function DeletedNotice({ projectId, entryId }: { projectId: string; entryId: string }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entryId)) return null;
  const [viewer, events] = await Promise.all([getViewer().catch(() => null), getEvents(projectId, 50).catch(() => [])]);
  const deleted = events.find((event) => event.kind === 'directory_entry_deleted' && event.subjectId === entryId);
  const path = typeof deleted?.payload?.path === 'string' ? deleted.payload.path : null;
  if (!viewer || !deleted || deleted.actorId !== viewer.id || !path || Date.now() - new Date(deleted.createdAt).getTime() > DELETED_NOTICE_MS) return null;
  return (
    <p className="notice" role="status">
      Deleted <span className="mono">{path}</span>.
    </p>
  );
}

function EmptyFolder({
  searching,
  view,
  listing,
  hiddenBranches,
  newBranch,
}: {
  searching: boolean;
  view: string | null;
  listing: DirectoryListing | null;
  hiddenBranches: number;
  /** Where to start a branch, for people who can. */
  newBranch: string | null;
}) {
  if (searching) {
    return (
      <EmptyState title={view === 'favorites' ? 'No favorites yet.' : 'No files match.'}>
        {view === 'favorites' && <p>Star a file to keep it here. Favorites are yours alone.</p>}
      </EmptyState>
    );
  }
  const area = listing?.location.area;
  if (area === 'branches') {
    return (
      <EmptyState title={hiddenBranches > 0 ? 'No open branches.' : 'No branches yet.'}>
        {newBranch && (
          <p>
            <Link href={newBranch}>Create a branch</Link> to start work toward a release.
          </p>
        )}
      </EmptyState>
    );
  }
  if (area === 'releases') return <EmptyState title="No releases yet." />;
  return (
    <EmptyState title="This folder is empty.">
      {listing?.location.writable && <p>Upload files or create a folder. Files here keep their own revisions, apart from branches and releases.</p>}
    </EmptyState>
  );
}

/**
 * Looks something up for each file by its contents, asking once per area: a file in a release
 * gets what that release was made with (its STEP and STL exports and the thumbnails drawn from
 * them), which never change; every other file gets the current ones.
 */
async function byArea<T>(files: readonly DirectoryFile[], load: (sha256s: string[], releaseNumber?: number) => Promise<Record<string, T>>) {
  const releaseOf = (file: DirectoryFile) => (file.location.area === 'release' ? file.location.releaseNumber : null);
  const releases = [...new Set(files.flatMap((file) => releaseOf(file) ?? []))];
  const [current, ...released] = await Promise.all([
    load(files.filter((file) => releaseOf(file) === null).map((file) => file.blob)),
    ...releases.map((number) => load(files.filter((file) => releaseOf(file) === number).map((file) => file.blob), number)),
  ]);
  const byRelease = new Map(releases.map((number, index) => [number, released[index]!]));
  return (file: DirectoryFile): T | undefined => {
    const number = releaseOf(file);
    return (number === null ? current : byRelease.get(number))?.[file.blob];
  };
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
  counts,
}: {
  project: Project;
  entries: DirectoryItem[];
  tags: ProjectTag[];
  canTag: boolean;
  signedIn: boolean;
  showLocation: boolean;
  sortLink: (column: Sort) => { href: string; active: 'ascending' | 'descending' | undefined };
  tagLink: (tagId: string) => string;
  counts?: { branches: number; releases: number };
}) {
  const owner = project.ownerHandle;
  const slug = project.slug;
  const files = entries.filter((entry): entry is DirectoryFile => entry.kind === 'file');
  // Contributors get a right-click menu on root files and folders.
  const editable = canTag && entries.some((entry) => entry.entryId);
  // Thumbnails still being drawn, so the table can look again for them.
  const pending: string[] = [];
  const [thumbnails, exportsFor, folders] = await Promise.all([
    byArea(files.filter((file) => hasModel(file.name)), async (sha256s, release) => {
      const links = await getThumbnailLinks(project.id, sha256s, release);
      pending.push(...links.pending);
      return links.thumbnails;
    }),
    byArea(files.filter((file) => isSolidWorks(file.name)), (sha256s, release) => getFileExports(project.id, sha256s, release)),
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
      <th scope="col" aria-sort={link.active} className={column === 'modified' ? 'col-modified' : undefined}>
        <Link href={link.href} className="sort-link" prefetch={false}>
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
            {showLocation && (
              <th scope="col" className="col-location">
                Location
              </th>
            )}
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
                      {entry.virtual === 'branches' ? (
                        <BranchIcon className="icon" />
                      ) : entry.virtual === 'releases' || entry.virtual === 'release' ? (
                        <LockIcon className="icon" />
                      ) : (
                        <FolderIcon className="icon" />
                      )}
                    </span>
                    <IntentLink href={treePath(owner, slug, entry.path)} className={entry.virtual === 'branches' || entry.virtual === 'releases' ? 'folder-name' : 'folder-name mono'}>
                      {entry.name}
                    </IntentLink>
                    {entry.branch && (
                      <>
                        <StatusBadge tone={branchTone(entry.branch.status)}>{BRANCH_STATUS_LABEL[entry.branch.status]}</StatusBadge>
                        {entry.branch.checkedOutByHandle && (
                          <span className="muted lock-note" title={`Checked out by @${entry.branch.checkedOutByHandle}${entry.branch.checkedOutMachine ? ` on ${entry.branch.checkedOutMachine}` : ''}`}>
                            <LockIcon className="icon" />@{entry.branch.checkedOutByHandle}
                            {entry.branch.checkedOutAt && (
                              <>
                                {' · '}
                                <RelativeTime value={entry.branch.checkedOutAt} />
                              </>
                            )}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </td>
                {showLocation && <td className="col-location" />}
                <td className="muted col-modified">
                  <RelativeTime value={entry.modifiedAt} />
                </td>
                <td className="muted nowrap">
                  {entry.virtual === 'branches' && counts ? `${counts.branches} ${counts.branches === 1 ? 'branch' : 'branches'}` : entry.virtual === 'releases' && counts ? `${counts.releases} ${counts.releases === 1 ? 'release' : 'releases'}` : null}
                </td>
                <td className="cell-action">{editable && entry.entryId && <RowMenuButton name={entry.name} />}</td>
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
                thumbnailUrl={thumbnails(entry)}
                fileExports={exportsFor(entry) ?? []}
                tagLink={tagLink}
                menuData={menuData(entry)}
              />
            ),
          )}
        </tbody>
      </table>
      {/* Thumbnails render in the background; look again for a minute while any are on their way. */}
      {pending.length > 0 && <RefreshSoon key={pending.join()} times={12} everyMs={5000} />}
    </div>
  );
  if (!editable) return table;
  return (
    <EntryMenu projectId={project.id} owner={owner} slug={slug} folders={folders}>
      {table}
      <p className="muted entry-menu-hint">Right-click a file or folder, or use its ⋯ button, to rename, move, or delete it.</p>
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
  fileExports: FileExport[];
  tagLink: (tagId: string) => string;
  menuData: Record<string, string>;
}) {
  const owner = project.ownerHandle;
  const slug = project.slug;
  const folder = locationLabel(file);
  const elsewhere = file.alsoIn ?? 0;
  const location = (
    <IntentLink href={treePath(owner, slug, folder)} className="mono muted location-link">
      {folder || project.name}
    </IntentLink>
  );
  return (
    <tr {...menuData}>
      <td>
        <span className="file-cell">
          <FileGlyph path={file.name} thumbnailUrl={thumbnailUrl} />
          <span className="file-name-block">
            {file.entryId ? (
              <IntentLink href={entryPath(owner, slug, file.entryId)} className="mono">
                {file.name}
              </IntentLink>
            ) : (
              <span className="mono">{file.name}</span>
            )}
            {/* On phones the Location column folds in under the name. */}
            {showLocation && <span className="file-location-inline">{location}</span>}
            {(file.tags.length > 0 || file.revision !== null || elsewhere > 0) && (
              <span className="file-meta">
                {file.revision !== null && file.revision > 1 && <span className="muted">Revision {file.revision}</span>}
                {elsewhere > 0 && (
                  <span className="muted">
                    Also in {elsewhere} other {elsewhere === 1 ? 'place' : 'places'}
                  </span>
                )}
                {file.tags.map((tag) => (
                  <Link key={tag.id} href={tagLink(tag.id)} className="tag-chip" prefetch={false}>
                    {tag.name}
                  </Link>
                ))}
              </span>
            )}
          </span>
        </span>
      </td>
      {showLocation && <td className="col-location">{location}</td>}
      <td className="muted col-modified">
        <RelativeTime value={file.modifiedAt} />
        {file.modifiedByHandle && <span className="modified-by"> by @{file.modifiedByHandle}</span>}
      </td>
      <td className="muted nowrap">{formatBytes(file.size)}</td>
      <td className="cell-action">
        <FileActions projectId={project.id} path={file.name} blob={file.blob} size={file.size} exports={fileExports} />
        {signedIn && <FavoriteButton projectId={project.id} itemId={file.itemId} favorite={file.favorite} name={file.name} />}
        {canTag && <TagPicker key={file.tags.map((tag) => tag.id).join()} projectId={project.id} itemId={file.itemId} name={file.name} tags={tags} selected={file.tags} />}
        {menuData['data-entry-id'] && <RowMenuButton name={file.name} />}
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
          <ActionForm action={createTag.bind(null, project.id)} submitLabel="Add tag" submitClassName="btn btn-secondary btn-small" className="form form-inline" resetOnSuccess>
            <label className="field">
              <span className="sr-only">New tag</span>
              <input name="name" required maxLength={50} placeholder="New tag" autoComplete="off" />
            </label>
          </ActionForm>
          {tags.map((tag) => (
            <ManageTag key={tag.id} projectId={project.id} tag={tag} />
          ))}
        </details>
      )}
    </section>
  );
}

/** Opens the row's rename, move, and delete menu, for people who can't or don't right-click. */
function RowMenuButton({ name }: { name: string }) {
  return (
    <button type="button" className="icon-button" data-entry-menu-button aria-label={`More actions for ${name}`} title="More actions">
      <MoreIcon className="icon" />
    </button>
  );
}
