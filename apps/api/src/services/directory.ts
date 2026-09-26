import { comparePaths, InvalidPathError, isReservedRootName, MAX_PATH_LENGTH, validateEntryName } from '@gigacad/core';
import type { Db, Sql, Tx } from '../db.js';
import { conflict, notFound, unprocessable } from '../errors.js';
import { projectAccess, requireProjectRole } from './access.js';
import type { BranchStatus } from './branches.js';
import { recordEvent } from './events.js';
import { loadManifest } from './manifests.js';

/**
 * The project file directory. The root holds ordinary files and folders with their own
 * revisions; `Branches/<name>/` and `Releases/v<n>/` are virtual folders showing branch
 * heads and releases as they are stored, read-only here. Changing a branch still means
 * checking it out and committing.
 */

export type FileArea = 'root' | 'branch' | 'release';
export type DirectorySort = 'name' | 'modified' | 'size';
export type SortOrder = 'asc' | 'desc';

export interface TagView {
  readonly id: string;
  readonly name: string;
}

/** Where one appearance of a file lives. The same item can appear in several places. */
export interface FileLocation {
  readonly area: FileArea;
  readonly branchId: string | null;
  readonly branchName: string | null;
  readonly releaseNumber: number | null;
  /** The file's path inside its area: from the project root, or inside the branch or release. */
  readonly path: string;
}

export interface DirectoryFile {
  readonly kind: 'file';
  readonly name: string;
  /** The full directory path, like `Designs/Arm.SLDPRT` or `Branches/main/parts/P1.SLDPRT`. */
  readonly path: string;
  readonly itemId: string;
  readonly blob: string;
  readonly size: number;
  readonly modifiedAt: Date;
  readonly modifiedByHandle: string | null;
  /** Root files only: the directory entry and its current revision number. */
  readonly entryId: string | null;
  readonly revision: number | null;
  readonly location: FileLocation;
  readonly tags: readonly TagView[];
  readonly favorite: boolean;
}

export interface DirectoryFolder {
  readonly kind: 'folder';
  readonly name: string;
  readonly path: string;
  /** Root folders only. */
  readonly entryId: string | null;
  /** `branches`/`releases` for the two root folders, `branch`/`release` for one snapshot, null for ordinary folders. */
  readonly virtual: 'branches' | 'releases' | 'branch' | 'release' | null;
  readonly modifiedAt: Date | null;
  readonly branch: BranchFolder | null;
  readonly release: { readonly number: number; readonly createdByHandle: string | null } | null;
}

export interface BranchFolder {
  readonly id: string;
  readonly status: BranchStatus;
  readonly checkedOutBy: string | null;
  readonly checkedOutByHandle: string | null;
  readonly checkedOutMachine: string | null;
}

export type DirectoryItem = DirectoryFile | DirectoryFolder;

export interface DirectoryLocation {
  /** `root` is the project root or a folder in it. */
  readonly area: 'root' | 'branches' | 'releases' | 'branch' | 'release';
  /** The normalized full path of the listed folder; empty for the project root. */
  readonly path: string;
  /** Each folder from the root down, for breadcrumbs. */
  readonly crumbs: readonly { readonly name: string; readonly path: string }[];
  /** The listed root folder; null at the project root and outside the root area. */
  readonly folderId: string | null;
  readonly branch: (BranchFolder & { readonly name: string }) | null;
  readonly release: { readonly number: number; readonly createdAt: Date; readonly createdByHandle: string | null } | null;
  /** Whether the caller may add, replace, move, or delete entries here. Only root folders are ever writable. */
  readonly writable: boolean;
}

export interface Page<T> {
  readonly entries: readonly T[];
  readonly total: number;
  readonly nextOffset: number | null;
}

export interface Paging {
  readonly sort: DirectorySort;
  readonly order?: SortOrder | undefined;
  readonly offset: number;
  readonly limit: number;
}

/** Name ascending; newest and largest first. */
const DEFAULT_ORDER: Record<DirectorySort, SortOrder> = { name: 'asc', modified: 'desc', size: 'desc' };

const splitPath = (path: string) => path.replace(/\\/g, '/').split('/').filter((segment) => segment !== '');
const joinPath = (...parts: (string | null | undefined)[]) => parts.filter((part) => part).join('/');
const lastSegment = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function crumbsFor(segments: readonly string[]) {
  return segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join('/') }));
}

function invalidName(error: unknown, name: string): never {
  if (error instanceof InvalidPathError) throw unprocessable('invalid_name', `The ${error.reason}.`, { name });
  throw error;
}

function checkName(name: string, atRoot: boolean): string {
  try {
    return validateEntryName(name, { atRoot });
  } catch (error) {
    if (error instanceof InvalidPathError && atRoot && isReservedRootName(name)) {
      throw unprocessable('reserved_name', `"${name}" is reserved for the project's ${name.toLowerCase()} folder`, { name });
    }
    return invalidName(error, name);
  }
}

// Reading ------------------------------------------------------------------

interface RootRow {
  readonly id: string;
  readonly kind: 'file' | 'folder';
  readonly name: string;
  readonly itemId: string | null;
  readonly revision: number | null;
  readonly blob: string | null;
  readonly size: number | null;
  readonly modifiedAt: Date;
  readonly modifiedByHandle: string | null;
}

async function rootChildren(db: Db, projectId: string, parentId: string | null): Promise<RootRow[]> {
  return db<RootRow[]>`
    select e.id, e.kind, e.name, e.item_id, rv.number as revision, rv.blob_sha256 as blob, b.size::float8 as size,
           coalesce(rv.created_at, e.updated_at) as modified_at, a.handle as modified_by_handle
    from directory_entries e
    left join lateral (
      select r.number, r.blob_sha256, r.created_at, r.author_id from root_file_revisions r
      where r.entry_id = e.id order by r.number desc limit 1
    ) rv on true
    left join blobs b on b.sha256 = rv.blob_sha256
    left join profiles a on a.id = coalesce(rv.author_id, e.created_by)
    where e.project_id = ${projectId} and e.parent_id is not distinct from ${parentId}::uuid
  `;
}

/** Finds a root folder by its path, case-insensitively, returning its id and the names as stored. */
async function resolveRootFolder(db: Db, projectId: string, segments: readonly string[]): Promise<{ id: string | null; names: string[] }> {
  let parentId: string | null = null;
  const names: string[] = [];
  for (const segment of segments) {
    const [folder]: { id: string; name: string; kind: string }[] = await db<{ id: string; name: string; kind: string }[]>`
      select id, name, kind from directory_entries
      where project_id = ${projectId} and parent_id is not distinct from ${parentId}::uuid and name_key = lower(${segment})
    `;
    if (!folder || folder.kind !== 'folder') throw notFound(`Folder ${joinPath(...names, segment)}`);
    parentId = folder.id;
    names.push(folder.name);
  }
  return { id: parentId, names };
}

function sortAndPage<T extends DirectoryItem>(items: T[], paging: Paging): Page<T> {
  const order = paging.order ?? DEFAULT_ORDER[paging.sort];
  const sign = order === 'asc' ? 1 : -1;
  // The root's Branches and Releases folders come first, in that order.
  const rank = (item: DirectoryItem) => (item.kind === 'folder' ? (item.virtual === 'branches' ? 0 : item.virtual === 'releases' ? 1 : 2) : 3);
  const key = (item: DirectoryItem) =>
    paging.sort === 'size' ? (item.kind === 'file' ? item.size : 0) : paging.sort === 'modified' ? (item.modifiedAt?.getTime() ?? 0) : 0;
  const byName = (a: DirectoryItem, b: DirectoryItem) =>
    // v10 sorts after v9.
    a.kind === 'folder' && b.kind === 'folder' && a.release && b.release ? a.release.number - b.release.number : comparePaths(a.name, b.name);
  const sorted = items.sort((a, b) => rank(a) - rank(b) || ((paging.sort === 'name' ? 0 : key(a) - key(b)) || byName(a, b)) * sign);
  const entries = sorted.slice(paging.offset, paging.offset + paging.limit);
  const next = paging.offset + entries.length;
  return { entries, total: sorted.length, nextOffset: next < sorted.length ? next : null };
}

interface Decorations {
  readonly tags: Map<string, TagView[]>;
  readonly favorites: Set<string>;
}

async function decorations(db: Db, projectId: string, viewerId: string | null, itemIds: readonly string[]): Promise<Decorations> {
  const unique = [...new Set(itemIds)];
  if (unique.length === 0) return { tags: new Map(), favorites: new Set() };
  const [tagRows, favoriteRows] = await Promise.all([
    db<{ itemId: string; id: string; name: string }[]>`
      select ft.item_id, t.id, t.name from file_tags ft join project_tags t on t.id = ft.tag_id
      where ft.project_id = ${projectId} and ft.item_id = any(${unique}::uuid[])
      order by t.name_key
    `,
    viewerId
      ? db<{ itemId: string }[]>`select item_id from file_favorites where user_id = ${viewerId} and item_id = any(${unique}::uuid[])`
      : Promise.resolve([]),
  ]);
  const tags = new Map<string, TagView[]>();
  for (const { itemId, id, name } of tagRows) (tags.get(itemId) ?? tags.set(itemId, []).get(itemId)!).push({ id, name });
  return { tags, favorites: new Set(favoriteRows.map((row) => row.itemId)) };
}

type Undecorated = Omit<DirectoryFile, 'tags' | 'favorite'>;

/** Fills in tags and the viewer's favorites for the files on one page. */
async function decorate<T extends DirectoryItem>(db: Db, projectId: string, viewerId: string | null, page: Page<T>): Promise<Page<T>> {
  const files = page.entries.filter((entry): entry is T & DirectoryFile => entry.kind === 'file');
  const { tags, favorites } = await decorations(db, projectId, viewerId, files.map((file) => file.itemId));
  return {
    ...page,
    entries: page.entries.map((entry) =>
      entry.kind === 'file' ? { ...entry, tags: tags.get(entry.itemId) ?? [], favorite: favorites.has(entry.itemId) } : entry,
    ),
  };
}

const withoutDecorations = (file: Undecorated): DirectoryFile => ({ ...file, tags: [], favorite: false });

async function listRoot(db: Db, projectId: string, segments: readonly string[]): Promise<{ location: Omit<DirectoryLocation, 'writable'>; items: DirectoryItem[] }> {
  const { id: folderId, names } = await resolveRootFolder(db, projectId, segments);
  const rows = await rootChildren(db, projectId, folderId);
  const items: DirectoryItem[] = rows.map((row) => {
    const path = joinPath(...names, row.name);
    if (row.kind === 'folder') {
      return { kind: 'folder', name: row.name, path, entryId: row.id, virtual: null, modifiedAt: row.modifiedAt, branch: null, release: null };
    }
    return withoutDecorations({
      kind: 'file',
      name: row.name,
      path,
      itemId: row.itemId!,
      blob: row.blob!,
      size: row.size ?? 0,
      modifiedAt: row.modifiedAt,
      modifiedByHandle: row.modifiedByHandle,
      entryId: row.id,
      revision: row.revision,
      location: { area: 'root', branchId: null, branchName: null, releaseNumber: null, path },
    });
  });
  if (folderId === null) {
    const [latest] = await db<{ branches: Date | null; releases: Date | null }[]>`
      select (select max(c.created_at) from commits c join branches b on b.id = c.branch_id where b.project_id = ${projectId}) as branches,
             (select max(created_at) from releases where project_id = ${projectId}) as releases
    `;
    items.unshift(
      { kind: 'folder', name: 'Branches', path: 'Branches', entryId: null, virtual: 'branches', modifiedAt: latest?.branches ?? null, branch: null, release: null },
      { kind: 'folder', name: 'Releases', path: 'Releases', entryId: null, virtual: 'releases', modifiedAt: latest?.releases ?? null, branch: null, release: null },
    );
  }
  return { location: { area: 'root', path: names.join('/'), crumbs: crumbsFor(names), folderId, branch: null, release: null }, items };
}

interface BranchRow extends BranchFolder {
  readonly name: string;
  readonly manifestId: string;
  readonly changedAt: Date;
}

const BRANCH_COLUMNS = (db: Db) => db`
  b.id, b.name, b.status, b.checked_out_by, h.handle as checked_out_by_handle, b.checked_out_machine,
  c.manifest_id, c.created_at as changed_at
`;

/**
 * The folders and files directly inside `prefix` of one snapshot. Folder names keep the
 * case of the first path that has them.
 */
function snapshotChildren(files: readonly { path: string; itemId: string; blob: string }[], prefix: readonly string[]) {
  const prefixKey = prefix.length > 0 ? `${prefix.join('/').toLowerCase()}/` : '';
  const folders = new Map<string, string>();
  const direct: { path: string; itemId: string; blob: string }[] = [];
  let found = prefix.length === 0;
  for (const file of files) {
    if (!file.path.toLowerCase().startsWith(prefixKey)) continue;
    found = true;
    const rest = file.path.slice(prefixKey.length);
    const slash = rest.indexOf('/');
    if (slash === -1) direct.push(file);
    else {
      const name = rest.slice(0, slash);
      if (!folders.has(name.toLowerCase())) folders.set(name.toLowerCase(), name);
    }
  }
  // The stored spelling of the prefix, for breadcrumbs.
  const sample = files.find((file) => file.path.toLowerCase().startsWith(prefixKey));
  const names = sample ? sample.path.split('/').slice(0, prefix.length) : [...prefix];
  return { found, folders: [...folders.values()], direct, names };
}

async function blobSizes(db: Db, blobs: readonly string[]): Promise<Map<string, number>> {
  const rows = await db<{ sha256: string; size: number }[]>`
    select sha256, size::float8 as size from blobs where sha256 = any(${[...new Set(blobs)]}::text[])
  `;
  return new Map(rows.map((row) => [row.sha256, row.size]));
}

async function listBranch(db: Db, projectId: string, branchName: string, inner: readonly string[]) {
  const [branch] = await db<BranchRow[]>`
    select ${BRANCH_COLUMNS(db)}
    from branches b join commits c on c.id = b.head_commit_id left join profiles h on h.id = b.checked_out_by
    where b.project_id = ${projectId} and lower(b.name) = lower(${branchName})
  `;
  if (!branch) throw notFound(`Branch ${branchName}`);
  const manifest = await loadManifest(db, branch.manifestId);
  const { found, folders, direct, names } = snapshotChildren(manifest, inner);
  if (!found) throw notFound(`Folder ${joinPath('Branches', branch.name, ...inner)}`);
  const base = ['Branches', branch.name, ...names];
  const [sizes, changes] = await Promise.all([
    blobSizes(db, direct.map((file) => file.blob)),
    db<{ itemId: string; changedAt: Date; handle: string | null }[]>`
      select f.item_id, ch.changed_at, a.handle
      from unnest(${direct.map((file) => file.itemId)}::uuid[], ${direct.map((file) => file.blob)}::text[]) as f (item_id, blob)
      cross join lateral branch_file_changed(${branch.id}, f.item_id, f.blob) ch
      left join profiles a on a.id = ch.author_id
    `,
  ]);
  const changedByItem = new Map(changes.map((row) => [row.itemId, row]));
  const items: DirectoryItem[] = [
    ...folders.map((name): DirectoryFolder => ({ kind: 'folder', name, path: joinPath(...base, name), entryId: null, virtual: null, modifiedAt: null, branch: null, release: null })),
    ...direct.map((file) => {
      const changed = changedByItem.get(file.itemId);
      return withoutDecorations({
        kind: 'file',
        name: lastSegment(file.path),
        path: joinPath('Branches', branch.name, file.path),
        itemId: file.itemId,
        blob: file.blob,
        size: sizes.get(file.blob) ?? 0,
        modifiedAt: changed?.changedAt ?? branch.changedAt,
        modifiedByHandle: changed?.handle ?? null,
        entryId: null,
        revision: null,
        location: { area: 'branch', branchId: branch.id, branchName: branch.name, releaseNumber: null, path: file.path },
      });
    }),
  ];
  const { manifestId: _, changedAt: __, ...folder } = branch;
  return {
    location: { area: 'branch' as const, path: base.join('/'), crumbs: crumbsFor(base), folderId: null, branch: folder, release: null },
    items,
  };
}

async function listRelease(db: Db, projectId: string, label: string, inner: readonly string[]) {
  const number = /^v?(\d{1,9})$/i.exec(label)?.[1];
  const [release] = number
    ? await db<{ number: number; manifestId: string; createdAt: Date; createdByHandle: string | null }[]>`
        select r.number, r.manifest_id, r.created_at, p.handle as created_by_handle
        from releases r left join profiles p on p.id = r.created_by
        where r.project_id = ${projectId} and r.number = ${Number(number)}
      `
    : [];
  if (!release) throw notFound(`Release ${label}`);
  const manifest = await loadManifest(db, release.manifestId);
  const { found, folders, direct, names } = snapshotChildren(manifest, inner);
  if (!found) throw notFound(`Folder ${joinPath('Releases', label, ...inner)}`);
  const base = ['Releases', `v${release.number}`, ...names];
  const sizes = await blobSizes(db, direct.map((file) => file.blob));
  const items: DirectoryItem[] = [
    ...folders.map((name): DirectoryFolder => ({ kind: 'folder', name, path: joinPath(...base, name), entryId: null, virtual: null, modifiedAt: release.createdAt, branch: null, release: null })),
    ...direct.map((file) =>
      withoutDecorations({
        kind: 'file',
        name: lastSegment(file.path),
        path: joinPath(...base.slice(0, 2), file.path),
        itemId: file.itemId,
        blob: file.blob,
        size: sizes.get(file.blob) ?? 0,
        modifiedAt: release.createdAt,
        modifiedByHandle: release.createdByHandle,
        entryId: null,
        revision: null,
        location: { area: 'release', branchId: null, branchName: null, releaseNumber: release.number, path: file.path },
      }),
    ),
  ];
  return {
    location: {
      area: 'release' as const,
      path: base.join('/'),
      crumbs: crumbsFor(base),
      folderId: null,
      branch: null,
      release: { number: release.number, createdAt: release.createdAt, createdByHandle: release.createdByHandle },
    },
    items,
  };
}

async function listBranchFolders(db: Db, projectId: string): Promise<DirectoryItem[]> {
  const branches = await db<BranchRow[]>`
    select ${BRANCH_COLUMNS(db)}
    from branches b join commits c on c.id = b.head_commit_id left join profiles h on h.id = b.checked_out_by
    where b.project_id = ${projectId}
  `;
  return branches.map(({ manifestId: _, changedAt, name, ...branch }) => ({
    kind: 'folder',
    name,
    path: joinPath('Branches', name),
    entryId: null,
    virtual: 'branch',
    modifiedAt: changedAt,
    branch,
    release: null,
  }));
}

async function listReleaseFolders(db: Db, projectId: string): Promise<DirectoryItem[]> {
  const releases = await db<{ number: number; createdAt: Date; createdByHandle: string | null }[]>`
    select r.number, r.created_at, p.handle as created_by_handle
    from releases r left join profiles p on p.id = r.created_by
    where r.project_id = ${projectId}
  `;
  return releases.map((release) => ({
    kind: 'folder',
    name: `v${release.number}`,
    path: `Releases/v${release.number}`,
    entryId: null,
    virtual: 'release',
    modifiedAt: release.createdAt,
    branch: null,
    release: { number: release.number, createdByHandle: release.createdByHandle },
  }));
}

/** Lists one folder of the project directory, by its path from the project root. */
export async function listDirectory(
  sql: Sql,
  projectId: string,
  viewerId: string | null,
  path: string,
  requested: Paging,
): Promise<{ location: DirectoryLocation } & Page<DirectoryItem>> {
  const { role } = await projectAccess(sql, projectId, viewerId);
  const segments = splitPath(path);
  const [first, second, ...rest] = segments;
  const area = first ? first.toLowerCase() : '';
  let paging = requested;

  let result: { location: Omit<DirectoryLocation, 'writable'>; items: DirectoryItem[] };
  if (area === 'branches' && second === undefined) {
    result = { location: { area: 'branches', path: 'Branches', crumbs: crumbsFor(['Branches']), folderId: null, branch: null, release: null }, items: await listBranchFolders(sql, projectId) };
  } else if (area === 'branches') {
    result = await listBranch(sql, projectId, second!, rest);
  } else if (area === 'releases' && second === undefined) {
    result = { location: { area: 'releases', path: 'Releases', crumbs: crumbsFor(['Releases']), folderId: null, branch: null, release: null }, items: await listReleaseFolders(sql, projectId) };
    // Newest release first unless asked otherwise.
    if (paging.sort === 'name' && !paging.order) paging = { ...paging, order: 'desc' };
  } else if (area === 'releases') {
    result = await listRelease(sql, projectId, second!, rest);
  } else {
    result = await listRoot(sql, projectId, segments);
  }

  const writable = result.location.area === 'root' && role !== null && role !== 'viewer';
  const page = await decorate(sql, projectId, viewerId, sortAndPage(result.items, paging));
  return { location: { ...result.location, writable }, ...page };
}

// Search -------------------------------------------------------------------

export interface SearchQuery {
  readonly q?: string | undefined;
  readonly tagIds?: readonly string[] | undefined;
  readonly favorites?: boolean | undefined;
  readonly area?: FileArea | undefined;
}

/**
 * Finds files across the root, every branch head, and every release, by path and tags, or
 * among the viewer's favorites. A file that appears in several places is returned once
 * per place, each with its location.
 */
export async function searchFiles(sql: Sql, projectId: string, viewerId: string | null, query: SearchQuery, paging: Paging): Promise<Page<DirectoryFile>> {
  await projectAccess(sql, projectId, viewerId);
  if (query.favorites && !viewerId) return { entries: [], total: 0, nextOffset: null };
  const q = query.q?.trim() ?? '';
  const pattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const tagIds = [...new Set(query.tagIds ?? [])];
  const order = (paging.order ?? DEFAULT_ORDER[paging.sort]) === 'asc' ? sql`asc` : sql`desc`;
  const sortKey =
    paging.sort === 'modified' ? sql`l.modified_at ${order}, lower(l.name)` : paging.sort === 'size' ? sql`b.size ${order}, lower(l.name)` : sql`lower(l.name) ${order}`;

  const rows = await sql<(Omit<Undecorated, 'kind' | 'location'> & { area: FileArea; branchId: string | null; branchName: string | null; releaseNumber: number | null; innerPath: string; total: number })[]>`
    with recursive root_paths as (
      select e.id, e.item_id, e.kind, e.name::text as path from directory_entries e
      where e.project_id = ${projectId} and e.parent_id is null
      union all
      select c.id, c.item_id, c.kind, rp.path || '/' || c.name from directory_entries c join root_paths rp on c.parent_id = rp.id
    ),
    located as (
      select 'root'::text as area, null::uuid as branch_id, null::text as branch_name, null::int as release_number,
             rp.id as entry_id, rp.item_id, rp.path as inner_path, rv.blob_sha256 as blob, rv.number as revision,
             rv.created_at as modified_at, rv.author_id as modified_by
      from root_paths rp
      cross join lateral (
        select r.number, r.blob_sha256, r.created_at, r.author_id from root_file_revisions r
        where r.entry_id = rp.id order by r.number desc limit 1
      ) rv
      where rp.kind = 'file' and ${query.area === undefined || query.area === 'root'}
      union all
      select 'branch', br.id, br.name, null, null, me.item_id, me.path, me.blob_sha256, null,
             coalesce(ch.changed_at, c.created_at), ch.author_id
      from branches br
      join commits c on c.id = br.head_commit_id
      join manifest_entries me on me.manifest_id = c.manifest_id
      left join lateral branch_file_changed(br.id, me.item_id, me.blob_sha256) ch on true
      where br.project_id = ${projectId} and ${query.area === undefined || query.area === 'branch'}
      union all
      select 'release', null, null, r.number, null, me.item_id, me.path, me.blob_sha256, null, r.created_at, r.created_by
      from releases r join manifest_entries me on me.manifest_id = r.manifest_id
      where r.project_id = ${projectId} and ${query.area === undefined || query.area === 'release'}
    )
    select l.area, l.branch_id, l.branch_name, l.release_number, l.entry_id, l.item_id, l.inner_path,
           l.name, l.blob, b.size::float8 as size, l.revision, l.modified_at, p.handle as modified_by_handle,
           count(*) over ()::int as total
    from (select *, regexp_replace(inner_path, '^.*/', '') as name from located) l
    join blobs b on b.sha256 = l.blob
    left join profiles p on p.id = l.modified_by
    where (${q} = '' or l.inner_path ilike ${pattern})
      and (${tagIds.length} = 0 or (
        select count(*) from file_tags ft where ft.item_id = l.item_id and ft.tag_id = any(${tagIds}::uuid[])
      ) = ${tagIds.length})
      and (${!query.favorites} or exists (
        select 1 from file_favorites f where f.user_id = ${viewerId}::uuid and f.item_id = l.item_id
      ))
    order by ${sortKey}, l.area, l.branch_name nulls last, l.release_number desc nulls last, l.inner_path
    limit ${paging.limit} offset ${paging.offset}
  `;
  const total = rows[0]?.total ?? 0;
  const files = rows.map(({ area, branchId, branchName, releaseNumber, innerPath, total: _, ...row }) =>
    withoutDecorations({
      ...row,
      kind: 'file',
      path: area === 'root' ? innerPath : area === 'branch' ? joinPath('Branches', branchName, innerPath) : joinPath('Releases', `v${releaseNumber}`, innerPath),
      location: { area, branchId, branchName, releaseNumber, path: innerPath },
    }),
  );
  const next = paging.offset + files.length;
  return decorate(sql, projectId, viewerId, { entries: files, total, nextOffset: next < total ? next : null });
}

// Root changes -------------------------------------------------------------

interface EntryRow {
  readonly id: string;
  readonly projectId: string;
  readonly parentId: string | null;
  readonly kind: 'file' | 'folder';
  readonly itemId: string | null;
  readonly name: string;
}

async function loadEntry(db: Db, projectId: string, entryId: string): Promise<EntryRow> {
  const [entry] = await db<EntryRow[]>`
    select id, project_id, parent_id, kind, item_id, name from directory_entries where project_id = ${projectId} and id = ${entryId}
  `;
  if (!entry) throw notFound('File or folder');
  return entry;
}

/** The entry's path from the project root. */
async function entryPath(db: Db, entryId: string | null): Promise<string> {
  if (entryId === null) return '';
  const [row] = await db<{ path: string }[]>`
    with recursive up as (
      select id, parent_id, name::text as path, 0 as depth from directory_entries where id = ${entryId}
      union all
      select p.id, p.parent_id, p.name || '/' || up.path, up.depth + 1 from directory_entries p join up on p.id = up.parent_id
    )
    select path from up order by depth desc limit 1
  `;
  return row?.path ?? '';
}

/** Checks a new entry's parent: a folder in the same project, or the root. */
async function requireFolder(db: Db, projectId: string, parentId: string | null): Promise<void> {
  if (parentId === null) return;
  const parent = await loadEntry(db, projectId, parentId).catch(() => null);
  if (!parent || parent.kind !== 'folder') throw notFound('Folder');
}

async function requireFreeName(db: Db, projectId: string, parentId: string | null, name: string, except: string | null = null): Promise<void> {
  const [taken] = await db<{ name: string }[]>`
    select name from directory_entries
    where project_id = ${projectId} and parent_id is not distinct from ${parentId}::uuid and name_key = lower(${name})
      and id is distinct from ${except}::uuid
  `;
  if (taken) throw conflict('name_taken', `"${taken.name}" already exists in this folder`, { name: taken.name });
}

/** `extra` is the length of the longest path inside a folder being moved. */
function requirePathLength(path: string, extra = 0): void {
  if (path.length + extra > MAX_PATH_LENGTH) throw unprocessable('path_too_long', `Paths can be at most ${MAX_PATH_LENGTH} characters`, { path });
}

async function requireUploaded(db: Db, projectId: string, blob: string): Promise<void> {
  const [present] = await db`select 1 from project_blobs where project_id = ${projectId} and sha256 = ${blob}`;
  if (!present) throw unprocessable('missing_blobs', 'Upload the file before adding it', { sha256s: [blob] });
}

export interface EntryView {
  readonly id: string;
  readonly kind: 'file' | 'folder';
  readonly name: string;
  readonly parentId: string | null;
  readonly path: string;
  readonly itemId: string | null;
  readonly revision: number | null;
  readonly blob: string | null;
}

async function entryView(db: Db, projectId: string, entryId: string): Promise<EntryView> {
  const entry = await loadEntry(db, projectId, entryId);
  const [current] = await db<{ number: number; blobSha256: string }[]>`
    select number, blob_sha256 from root_file_revisions where entry_id = ${entryId} order by number desc limit 1
  `;
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    parentId: entry.parentId,
    path: await entryPath(db, entry.id),
    itemId: entry.itemId,
    revision: current?.number ?? null,
    blob: current?.blobSha256 ?? null,
  };
}

/** Directory changes take the project row lock, so checks like "is the destination inside the folder" can't race. */
async function writeAccess(tx: Tx, projectId: string, userId: string) {
  return requireProjectRole(tx, projectId, userId, 'contributor', { lock: true });
}

export async function createFolder(sql: Sql, projectId: string, userId: string, input: { parentId: string | null; name: string }): Promise<EntryView> {
  return sql.begin(async (tx) => {
    await writeAccess(tx, projectId, userId);
    const name = checkName(input.name, input.parentId === null);
    await requireFolder(tx, projectId, input.parentId);
    requirePathLength(joinPath(await entryPath(tx, input.parentId), name));
    await requireFreeName(tx, projectId, input.parentId, name);
    const [entry] = await tx<{ id: string }[]>`
      insert into directory_entries (project_id, parent_id, kind, name, created_by)
      values (${projectId}, ${input.parentId}, 'folder', ${name}, ${userId})
      returning id
    `;
    const view = await entryView(tx, projectId, entry!.id);
    await recordEvent(tx, { projectId, actorId: userId, kind: 'directory_entry_created', subjectId: view.id, payload: { kind: 'folder', path: view.path } });
    return view;
  });
}

/** Adds a new root file whose contents are already uploaded to the project, as its first revision. */
export async function createFile(sql: Sql, projectId: string, userId: string, input: { parentId: string | null; name: string; blob: string }): Promise<EntryView> {
  return sql.begin(async (tx) => {
    await writeAccess(tx, projectId, userId);
    const name = checkName(input.name, input.parentId === null);
    await requireFolder(tx, projectId, input.parentId);
    requirePathLength(joinPath(await entryPath(tx, input.parentId), name));
    await requireFreeName(tx, projectId, input.parentId, name);
    await requireUploaded(tx, projectId, input.blob);
    const [item] = await tx<{ id: string }[]>`insert into items (project_id) values (${projectId}) returning id`;
    const [entry] = await tx<{ id: string }[]>`
      insert into directory_entries (project_id, parent_id, kind, item_id, name, created_by)
      values (${projectId}, ${input.parentId}, 'file', ${item!.id}, ${name}, ${userId})
      returning id
    `;
    await tx`
      insert into root_file_revisions (project_id, entry_id, number, blob_sha256, author_id)
      values (${projectId}, ${entry!.id}, 1, ${input.blob}, ${userId})
    `;
    const view = await entryView(tx, projectId, entry!.id);
    await recordEvent(tx, { projectId, actorId: userId, kind: 'directory_entry_created', subjectId: view.id, payload: { kind: 'file', path: view.path } });
    return view;
  });
}

/** Records new contents for a root file. Branches and releases are untouched. Replacing with the current contents changes nothing. */
export async function replaceFile(sql: Sql, projectId: string, userId: string, entryId: string, blob: string): Promise<EntryView> {
  return sql.begin(async (tx) => {
    await writeAccess(tx, projectId, userId);
    const entry = await loadEntry(tx, projectId, entryId);
    if (entry.kind !== 'file') throw unprocessable('not_a_file', 'Only files can be replaced');
    await requireUploaded(tx, projectId, blob);
    const [current] = await tx<{ number: number; blobSha256: string }[]>`
      select number, blob_sha256 from root_file_revisions where entry_id = ${entryId} order by number desc limit 1
    `;
    if (current?.blobSha256 === blob) return entryView(tx, projectId, entryId);
    const number = (current?.number ?? 0) + 1;
    await tx`
      insert into root_file_revisions (project_id, entry_id, number, blob_sha256, author_id)
      values (${projectId}, ${entryId}, ${number}, ${blob}, ${userId})
    `;
    await tx`update directory_entries set updated_at = now() where id = ${entryId}`;
    const view = await entryView(tx, projectId, entryId);
    await recordEvent(tx, { projectId, actorId: userId, kind: 'root_file_replaced', subjectId: entryId, payload: { path: view.path, revision: number } });
    return view;
  });
}

/**
 * Renames and/or moves a root entry. It keeps its identity, revisions, and tags. Fails
 * without changes if the destination has that name already, is inside the folder being
 * moved, or would make a path too long.
 */
export async function moveEntry(
  sql: Sql,
  projectId: string,
  userId: string,
  entryId: string,
  input: { name?: string | undefined; parentId?: string | null | undefined },
): Promise<EntryView> {
  return sql.begin(async (tx) => {
    await writeAccess(tx, projectId, userId);
    const entry = await loadEntry(tx, projectId, entryId);
    const parentId = input.parentId === undefined ? entry.parentId : input.parentId;
    const name = checkName(input.name ?? entry.name, parentId === null);
    if (parentId === entry.parentId && name === entry.name) return entryView(tx, projectId, entryId);

    await requireFolder(tx, projectId, parentId);
    if (parentId !== null && entry.kind === 'folder') {
      const [inside] = await tx`
        with recursive up as (
          select id, parent_id from directory_entries where id = ${parentId}
          union all
          select p.id, p.parent_id from directory_entries p join up on p.id = up.parent_id
        )
        select 1 from up where id = ${entryId}
      `;
      if (inside) throw unprocessable('move_into_itself', 'A folder can’t be moved into itself');
    }
    await requireFreeName(tx, projectId, parentId, name, entryId);
    // The longest path under the moved entry, relative to it.
    const [deepest] = await tx<{ length: number }[]>`
      with recursive down as (
        select id, 0 as length from directory_entries where id = ${entryId}
        union all
        select c.id, down.length + 1 + length(c.name) from directory_entries c join down on c.parent_id = down.id
      )
      select max(length)::int as length from down
    `;
    requirePathLength(joinPath(await entryPath(tx, parentId), name), deepest?.length ?? 0);

    const from = await entryPath(tx, entryId);
    await tx`update directory_entries set name = ${name}, parent_id = ${parentId}, updated_at = now() where id = ${entryId}`;
    const view = await entryView(tx, projectId, entryId);
    await recordEvent(tx, { projectId, actorId: userId, kind: 'directory_entry_moved', subjectId: entryId, payload: { kind: entry.kind, from, to: view.path } });
    return view;
  });
}

/** Deletes a root file, or a folder with everything in it, including their revisions, tags, and favorites. */
export async function deleteEntry(sql: Sql, projectId: string, userId: string, entryId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await writeAccess(tx, projectId, userId);
    const entry = await loadEntry(tx, projectId, entryId);
    const path = await entryPath(tx, entryId);
    const items = await tx<{ itemId: string }[]>`
      with recursive down as (
        select id, item_id from directory_entries where id = ${entryId}
        union all
        select c.id, c.item_id from directory_entries c join down on c.parent_id = down.id
      )
      select item_id from down where item_id is not null
    `;
    await tx`delete from directory_entries where id = ${entryId}`;
    // Root files never appear in manifests, so their items go too, with their tags and favorites.
    if (items.length > 0) await tx`delete from items where id = any(${items.map((row) => row.itemId)}::uuid[])`;
    await recordEvent(tx, { projectId, actorId: userId, kind: 'directory_entry_deleted', subjectId: entryId, payload: { kind: entry.kind, path } });
  });
}

export interface RevisionView {
  readonly number: number;
  readonly blob: string;
  readonly size: number;
  readonly authorId: string | null;
  readonly authorHandle: string | null;
  readonly createdAt: Date;
}

/** A root file with its revisions, newest first. */
export async function getEntry(
  sql: Sql,
  projectId: string,
  viewerId: string | null,
  entryId: string,
): Promise<{ entry: EntryView; revisions: RevisionView[]; tags: TagView[]; favorite: boolean; writable: boolean }> {
  const { role } = await projectAccess(sql, projectId, viewerId);
  const entry = await entryView(sql, projectId, entryId);
  const revisions = await sql<RevisionView[]>`
    select r.number, r.blob_sha256 as blob, b.size::float8 as size, r.author_id, a.handle as author_handle, r.created_at
    from root_file_revisions r join blobs b on b.sha256 = r.blob_sha256 left join profiles a on a.id = r.author_id
    where r.entry_id = ${entryId} order by r.number desc
  `;
  const { tags, favorites } = await decorations(sql, projectId, viewerId, entry.itemId ? [entry.itemId] : []);
  return {
    entry,
    revisions,
    tags: entry.itemId ? (tags.get(entry.itemId) ?? []) : [],
    favorite: entry.itemId ? favorites.has(entry.itemId) : false,
    writable: role !== null && role !== 'viewer',
  };
}

// Tags and favorites ---------------------------------------------------------

export interface ProjectTag extends TagView {
  /** How many files carry it. */
  readonly fileCount: number;
}

export async function listTags(sql: Sql, projectId: string, viewerId: string | null): Promise<ProjectTag[]> {
  await projectAccess(sql, projectId, viewerId);
  return sql<ProjectTag[]>`
    select t.id, t.name, (select count(*)::int from file_tags ft where ft.tag_id = t.id) as file_count
    from project_tags t where t.project_id = ${projectId} order by t.name_key
  `;
}

function checkTagName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 50) throw unprocessable('invalid_tag', 'Tag names are 1 to 50 characters');
  return trimmed;
}

async function requireFreeTagName(db: Db, projectId: string, name: string, except: string | null = null) {
  const [taken] = await db<{ name: string }[]>`
    select name from project_tags where project_id = ${projectId} and name_key = lower(${name}) and id is distinct from ${except}::uuid
  `;
  if (taken) throw conflict('tag_exists', `The tag "${taken.name}" already exists`);
}

export async function createTag(sql: Sql, projectId: string, userId: string, input: { name: string }): Promise<ProjectTag> {
  return sql.begin(async (tx) => {
    await requireProjectRole(tx, projectId, userId, 'contributor', { lock: true });
    const name = checkTagName(input.name);
    await requireFreeTagName(tx, projectId, name);
    const [tag] = await tx<{ id: string; name: string }[]>`
      insert into project_tags (project_id, name, created_by) values (${projectId}, ${name}, ${userId}) returning id, name
    `;
    await recordEvent(tx, { projectId, actorId: userId, kind: 'tag_created', subjectId: tag!.id, payload: { name } });
    return { ...tag!, fileCount: 0 };
  });
}

async function loadTag(db: Db, projectId: string, tagId: string) {
  const [tag] = await db<{ id: string; name: string }[]>`select id, name from project_tags where project_id = ${projectId} and id = ${tagId}`;
  if (!tag) throw notFound('Tag');
  return tag;
}

export async function renameTag(sql: Sql, projectId: string, userId: string, tagId: string, input: { name: string }): Promise<ProjectTag> {
  return sql.begin(async (tx) => {
    await requireProjectRole(tx, projectId, userId, 'contributor', { lock: true });
    const before = await loadTag(tx, projectId, tagId);
    const name = checkTagName(input.name);
    await requireFreeTagName(tx, projectId, name, tagId);
    await tx`update project_tags set name = ${name} where id = ${tagId}`;
    await recordEvent(tx, { projectId, actorId: userId, kind: 'tag_renamed', subjectId: tagId, payload: { from: before.name, to: name } });
    const [count] = await tx<{ fileCount: number }[]>`select count(*)::int as file_count from file_tags where tag_id = ${tagId}`;
    return { id: tagId, name, fileCount: count?.fileCount ?? 0 };
  });
}

export async function deleteTag(sql: Sql, projectId: string, userId: string, tagId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await requireProjectRole(tx, projectId, userId, 'contributor', { lock: true });
    const tag = await loadTag(tx, projectId, tagId);
    await tx`delete from project_tags where id = ${tagId}`;
    await recordEvent(tx, { projectId, actorId: userId, kind: 'tag_deleted', subjectId: tagId, payload: { name: tag.name } });
  });
}

async function requireItem(db: Db, projectId: string, itemId: string): Promise<void> {
  const [item] = await db`select 1 from items where project_id = ${projectId} and id = ${itemId}`;
  if (!item) throw notFound('File');
}

/**
 * Sets a file's tags. Tags belong to the file itself, so they show wherever it appears,
 * including in older releases.
 */
export async function setFileTags(sql: Sql, projectId: string, userId: string, itemId: string, tagIds: readonly string[]): Promise<TagView[]> {
  return sql.begin(async (tx) => {
    await requireProjectRole(tx, projectId, userId, 'contributor', { lock: true });
    await requireItem(tx, projectId, itemId);
    const wanted = [...new Set(tagIds)];
    const known = await tx<{ id: string }[]>`select id from project_tags where project_id = ${projectId} and id = any(${wanted}::uuid[])`;
    if (known.length !== wanted.length) throw unprocessable('unknown_tags', 'Some tags do not belong to this project');
    await tx`delete from file_tags where item_id = ${itemId} and tag_id <> all(${wanted}::uuid[])`;
    if (wanted.length > 0) {
      await tx`
        insert into file_tags ${tx(wanted.map((tagId) => ({ projectId, tagId, itemId, createdBy: userId })))}
        on conflict do nothing
      `;
    }
    await recordEvent(tx, { projectId, actorId: userId, kind: 'file_tags_changed', subjectId: itemId, payload: { tagIds: wanted } });
    return tx<TagView[]>`
      select t.id, t.name from file_tags ft join project_tags t on t.id = ft.tag_id where ft.item_id = ${itemId} order by t.name_key
    `;
  });
}

/** Stars a file for the caller alone. Anyone who can see the project can keep favorites in it. */
export async function setFavorite(sql: Sql, projectId: string, userId: string, itemId: string, favorite: boolean): Promise<{ favorite: boolean }> {
  await projectAccess(sql, projectId, userId);
  await requireItem(sql, projectId, itemId);
  if (favorite) {
    await sql`insert into file_favorites (user_id, project_id, item_id) values (${userId}, ${projectId}, ${itemId}) on conflict do nothing`;
  } else {
    await sql`delete from file_favorites where user_id = ${userId} and item_id = ${itemId}`;
  }
  return { favorite };
}

/** Every root folder with its path, for choosing where to move something. */
export async function listRootFolders(sql: Sql, projectId: string, viewerId: string | null): Promise<{ id: string; path: string }[]> {
  await projectAccess(sql, projectId, viewerId);
  const rows = await sql<{ id: string; path: string }[]>`
    with recursive folders as (
      select id, name::text as path from directory_entries where project_id = ${projectId} and parent_id is null and kind = 'folder'
      union all
      select c.id, f.path || '/' || c.name from directory_entries c join folders f on c.parent_id = f.id where c.kind = 'folder'
    )
    select id, path from folders
  `;
  return rows.sort((a, b) => comparePaths(a.path, b.path));
}
