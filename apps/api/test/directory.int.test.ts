import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unlinkUnusedBlobs } from '../src/jobs.js';
import { client, commitVersion, createHarness, createUser, MACHINE, sha256, upload, type Client, type Harness, type TestUser } from './helpers.js';

let harness: Harness;
let owner: TestUser;
let helper: TestUser;
let reader: TestUser;
let stranger: TestUser;
let api: Client;
let asHelper: Client;
let asReader: Client;
let asStranger: Client;
let anonymous: Client;

beforeAll(async () => {
  harness = await createHarness();
  [owner, helper, reader, stranger] = await Promise.all([
    createUser(harness, 'librarian'),
    createUser(harness, 'helper'),
    createUser(harness, 'reader'),
    createUser(harness, 'stranger'),
  ]);
  api = client(harness, owner);
  asHelper = client(harness, helper);
  asReader = client(harness, reader);
  asStranger = client(harness, stranger);
  anonymous = client(harness, null);
});

afterAll(async () => {
  await harness?.close();
});

async function project(visibility: 'public' | 'private' = 'private') {
  const created = await api.post('/v1/projects', { slug: `dir-${randomUUID().slice(0, 8)}`, name: 'Directory', visibility });
  const projectId = created.body.id as string;
  await api.put(`/v1/projects/${projectId}/members`, { handle: helper.handle, role: 'contributor' });
  await api.put(`/v1/projects/${projectId}/members`, { handle: reader.handle, role: 'viewer' });
  return projectId;
}

async function release(projectId: string, branchId: string) {
  const opened = await api.post(`/v1/branches/${branchId}/release-requests`, { title: 'Release' });
  const requestId = opened.body.releaseRequest.id;
  await api.post(`/v1/release-requests/${requestId}/candidate`);
  await api.post(`/v1/release-requests/${requestId}/approvals`);
  const released = await api.post(`/v1/release-requests/${requestId}/release`);
  expect(released.status).toBe(201);
  return released.body.release.number as number;
}

/** Uploads contents and adds them as a root file. */
async function addFile(as: Client, projectId: string, parentId: string | null, name: string, content: string) {
  const [blob] = await upload(harness, as, projectId, [content]);
  return as.post(`/v1/projects/${projectId}/directory/files`, { parentId, name, blob });
}

const list = (as: Client, projectId: string, path = '', query = '') =>
  as.get(`/v1/projects/${projectId}/directory?path=${encodeURIComponent(path)}${query}`);
const names = (body: { entries: { name: string }[] }) => body.entries.map((entry) => entry.name);

describe('the project root', () => {
  it('starts with only Branches and Releases, which show existing branches and releases', async () => {
    const projectId = await project();
    const root = await list(api, projectId);
    expect(root.status).toBe(200);
    expect(names(root.body)).toEqual(['Branches', 'Releases']);
    expect(root.body.location).toMatchObject({ area: 'root', path: '', writable: true });

    const branch = await api.post(`/v1/projects/${projectId}/branches`, { name: 'work' });
    await commitVersion(harness, api, projectId, branch.body.id, { 'Top.SLDASM': `top ${randomUUID()}`, 'parts/P1.SLDPRT': `p1 ${randomUUID()}` });
    await release(projectId, branch.body.id);

    expect(names((await list(api, projectId, 'Branches')).body)).toEqual(['work']);
    const head = await list(api, projectId, 'branches/WORK');
    expect(head.body.location).toMatchObject({ area: 'branch', path: 'Branches/work', writable: false, branch: { name: 'work', status: 'released' } });
    expect(head.body.entries.map((entry: { kind: string; name: string }) => `${entry.kind}:${entry.name}`)).toEqual(['folder:parts', 'file:Top.SLDASM']);
    const parts = await list(api, projectId, 'Branches/work/parts');
    expect(parts.body.entries[0]).toMatchObject({ name: 'P1.SLDPRT', path: 'Branches/work/parts/P1.SLDPRT', location: { area: 'branch', path: 'parts/P1.SLDPRT' } });

    expect(names((await list(api, projectId, 'Releases')).body)).toEqual(['v1']);
    const v1 = await list(api, projectId, 'Releases/v1');
    expect(v1.body.location).toMatchObject({ area: 'release', writable: false, release: { number: 1 } });
    expect(names(v1.body)).toEqual(['parts', 'Top.SLDASM']);
    expect((await list(api, projectId, 'Releases/v2')).status).toBe(404);
    expect((await list(api, projectId, 'Nowhere')).status).toBe(404);
  });

  it('keeps nested and empty folders, and files with their revisions, through renames and moves', async () => {
    const projectId = await project();
    const designs = await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId: null, name: 'Designs' });
    expect(designs.status).toBe(201);
    const drafts = await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId: designs.body.id, name: 'Drafts' });
    const empty = await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId: null, name: 'Empty' });
    expect(drafts.body.path).toBe('Designs/Drafts');

    const added = await addFile(asHelper, projectId, drafts.body.id, 'Arm.SLDPRT', `arm 1 ${randomUUID()}`);
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ kind: 'file', path: 'Designs/Drafts/Arm.SLDPRT', revision: 1 });
    const { id: entryId, itemId } = added.body;

    // Replacing records a revision; the same contents again changes nothing.
    const [second] = await upload(harness, asHelper, projectId, [`arm 2 ${randomUUID()}`]);
    const replaced = await asHelper.post(`/v1/projects/${projectId}/directory/entries/${entryId}/revisions`, { blob: second });
    expect(replaced.body).toMatchObject({ revision: 2, blob: second, itemId });
    expect((await asHelper.post(`/v1/projects/${projectId}/directory/entries/${entryId}/revisions`, { blob: second })).body.revision).toBe(2);

    const tag = await api.post(`/v1/projects/${projectId}/tags`, { name: 'Machined' });
    expect((await asHelper.put(`/v1/projects/${projectId}/items/${itemId}/tags`, { tagIds: [tag.body.id] })).status).toBe(200);

    // Rename, then move the folder holding it to the root's Empty folder: nothing new is recorded.
    expect((await api.patch(`/v1/projects/${projectId}/directory/entries/${entryId}`, { name: 'Arm rev B.SLDPRT' })).body.path).toBe('Designs/Drafts/Arm rev B.SLDPRT');
    const moved = await api.patch(`/v1/projects/${projectId}/directory/entries/${drafts.body.id}`, { parentId: empty.body.id });
    expect(moved.body.path).toBe('Empty/Drafts');

    const detail = await asReader.get(`/v1/projects/${projectId}/directory/entries/${entryId}`);
    expect(detail.body.entry).toMatchObject({ path: 'Empty/Drafts/Arm rev B.SLDPRT', itemId, revision: 2 });
    expect(detail.body.revisions.map((revision: { number: number }) => revision.number)).toEqual([2, 1]);
    expect(detail.body.tags).toEqual([{ id: tag.body.id, name: 'Machined' }]);
    expect(detail.body.writable).toBe(false);

    const root = await list(api, projectId);
    expect(names(root.body)).toEqual(['Branches', 'Releases', 'Designs', 'Empty']);
    expect((await asReader.get(`/v1/projects/${projectId}/directory/folders`)).body.map((folder: { path: string }) => folder.path)).toEqual([
      'Designs',
      'Empty',
      'Empty/Drafts',
    ]);
    expect(names((await list(api, projectId, 'Designs')).body)).toEqual([]);
    const folder = await list(asReader, projectId, 'empty/drafts');
    expect(folder.body.entries[0]).toMatchObject({ name: 'Arm rev B.SLDPRT', entryId, revision: 2, tags: [{ name: 'Machined' }], location: { area: 'root' } });
    expect(folder.body.location.crumbs.map((crumb: { name: string }) => crumb.name)).toEqual(['Empty', 'Drafts']);
  });

  it('refuses collisions, reserved names, bad names, long paths, and moving a folder into itself, changing nothing', async () => {
    const projectId = await project();
    const outer = await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId: null, name: 'Outer' });
    const inner = await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId: outer.body.id, name: 'Inner' });
    const file = await addFile(api, projectId, null, 'Plate.DXF', `plate ${randomUUID()}`);

    expect((await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId: null, name: 'outer' })).body.error.code).toBe('name_taken');
    expect((await addFile(api, projectId, null, 'PLATE.dxf', `other ${randomUUID()}`)).body.error.code).toBe('name_taken');
    expect((await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId: null, name: 'branches' })).body.error.code).toBe('reserved_name');
    expect((await api.patch(`/v1/projects/${projectId}/directory/entries/${file.body.id}`, { name: 'Releases' })).body.error.code).toBe('reserved_name');
    // Inside a folder the names are ordinary.
    expect((await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId: outer.body.id, name: 'Releases' })).status).toBe(201);
    for (const bad of ['a/b', 'what?', 'CON', 'dot.', '..']) {
      expect((await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId: null, name: bad })).body.error.code).toBe('invalid_name');
    }

    const intoItself = await api.patch(`/v1/projects/${projectId}/directory/entries/${outer.body.id}`, { parentId: inner.body.id });
    expect(intoItself.status).toBe(422);
    expect(intoItself.body.error.code).toBe('move_into_itself');
    expect((await api.patch(`/v1/projects/${projectId}/directory/entries/${outer.body.id}`, { parentId: outer.body.id })).body.error.code).toBe('move_into_itself');
    expect((await api.patch(`/v1/projects/${projectId}/directory/entries/${file.body.id}`, { name: 'outer' })).body.error.code).toBe('name_taken');

    // A chain of long folder names reaches the path limit; moving a deep folder under it fails.
    let parentId: string | null = null;
    for (let depth = 0; depth < 4; depth++) {
      const created: { body: { id: string } } = await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId, name: `${depth}${'x'.repeat(240)}` });
      parentId = created.body.id;
    }
    expect((await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId, name: 'y'.repeat(60) })).body.error.code).toBe('path_too_long');
    // 967 characters deep so far. Outer/Releases adds 15, so it fits here but not 46 characters deeper.
    const deep = await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId, name: 'y'.repeat(45) });
    expect(deep.status).toBe(201);
    expect((await api.patch(`/v1/projects/${projectId}/directory/entries/${outer.body.id}`, { parentId: deep.body.id })).body.error.code).toBe('path_too_long');

    const unchanged = await list(api, projectId, 'Outer');
    expect(names(unchanged.body)).toEqual(['Inner', 'Releases']);
    expect((await list(api, projectId)).body.entries.filter((entry: { name: string }) => entry.name === 'Plate.DXF')).toHaveLength(1);
  });

  it('leaves branches and releases alone, and branch files still need a checkout', async () => {
    const projectId = await project();
    const branch = await api.post(`/v1/projects/${projectId}/branches`, { name: 'main-work' });
    const committed = await commitVersion(harness, api, projectId, branch.body.id, { 'Base.SLDPRT': `base ${randomUUID()}` });
    await release(projectId, branch.body.id);
    const next = await api.post(`/v1/projects/${projectId}/branches`, { name: 'next' });
    const before = await api.get(`/v1/branches/${next.body.id}`);

    // A root file with the same name as a branch file is a different file.
    const root = await addFile(api, projectId, null, 'Base.SLDPRT', `root copy ${randomUUID()}`);
    expect(root.body.itemId).not.toBe(committed.files[0]!.itemId);
    const after = await api.get(`/v1/branches/${next.body.id}`);
    expect(after.body.head.id).toBe(before.body.head.id);
    expect(after.body.files).toEqual(before.body.files);
    expect((await api.get(`/v1/projects/${projectId}/releases/1`)).body.files).toEqual(before.body.files);

    // Only commits change a branch, and committing needs the checkout.
    const [blob] = await upload(harness, api, projectId, [`edited ${randomUUID()}`]);
    const unlocked = await api.post(`/v1/branches/${next.body.id}/commits`, {
      parentId: after.body.head.id,
      machine: MACHINE,
      kind: 'version',
      files: [{ path: 'Base.SLDPRT', blob, itemId: committed.files[0]!.itemId }],
    });
    expect(unlocked.status).toBe(409);

    // Nothing in the directory API reaches branch or release files.
    const releaseEntries = await list(api, projectId, 'Releases/v1');
    expect(releaseEntries.body.entries[0].entryId).toBeNull();
    expect((await api.patch(`/v1/projects/${projectId}/directory/entries/${committed.files[0]!.itemId}`, { name: 'x.SLDPRT' })).status).toBe(404);
  });
});

describe('tags, favorites, recent files, and search', () => {
  it('find root, branch, and release appearances of a file, each with its location', async () => {
    const projectId = await project();
    const branch = await api.post(`/v1/projects/${projectId}/branches`, { name: 'dev' });
    const committed = await commitVersion(harness, api, projectId, branch.body.id, { 'frame/Rail.SLDPRT': `rail ${randomUUID()}`, 'Notes.txt': 'notes' });
    await release(projectId, branch.body.id);
    const rootRail = await addFile(api, projectId, null, 'Rail drawing.PDF', `pdf ${randomUUID()}`);
    const railItem = committed.files.find((file) => file.path === 'frame/Rail.SLDPRT')!.itemId;

    const found = await asReader.get(`/v1/projects/${projectId}/files?q=rail`);
    expect(found.status).toBe(200);
    expect(found.body.total).toBe(3);
    const where = found.body.entries.map((file: { path: string }) => file.path).sort();
    expect(where).toEqual(['Branches/dev/frame/Rail.SLDPRT', 'Rail drawing.PDF', 'Releases/v1/frame/Rail.SLDPRT']);
    // One logical file, two appearances.
    expect(found.body.entries.filter((file: { itemId: string }) => file.itemId === railItem)).toHaveLength(2);
    expect((await asReader.get(`/v1/projects/${projectId}/files?q=rail&area=release`)).body.entries[0].location).toEqual({
      area: 'release',
      branchId: null,
      branchName: null,
      releaseNumber: 1,
      path: 'frame/Rail.SLDPRT',
    });
    // Search text is literal.
    expect((await asReader.get(`/v1/projects/${projectId}/files?q=${encodeURIComponent('%')}`)).body.total).toBe(0);

    // Tags follow the file into every snapshot; a file needs every requested tag.
    const steel = await asHelper.post(`/v1/projects/${projectId}/tags`, { name: 'Steel' });
    const cut = await asHelper.post(`/v1/projects/${projectId}/tags`, { name: 'Laser cut' });
    expect((await asHelper.post(`/v1/projects/${projectId}/tags`, { name: 'steel' })).body.error.code).toBe('tag_exists');
    await asHelper.put(`/v1/projects/${projectId}/items/${railItem}/tags`, { tagIds: [steel.body.id, cut.body.id] });
    await asHelper.put(`/v1/projects/${projectId}/items/${rootRail.body.itemId}/tags`, { tagIds: [steel.body.id] });
    expect((await asReader.get(`/v1/projects/${projectId}/files?tags=${steel.body.id}`)).body.total).toBe(3);
    const both = await asReader.get(`/v1/projects/${projectId}/files?tags=${steel.body.id},${cut.body.id}`);
    expect(both.body.entries.map((file: { location: { area: string } }) => file.location.area).sort()).toEqual(['branch', 'release']);
    expect(both.body.entries[0].tags.map((tag: { name: string }) => tag.name)).toEqual(['Laser cut', 'Steel']);
    const tags = await asReader.get(`/v1/projects/${projectId}/tags`);
    expect(tags.body.map((tag: { name: string; fileCount: number }) => [tag.name, tag.fileCount])).toEqual([['Laser cut', 1], ['Steel', 2]]);

    // Viewers can't tag; renaming shows everywhere; deleting removes it from files.
    expect((await asReader.put(`/v1/projects/${projectId}/items/${railItem}/tags`, { tagIds: [] })).status).toBe(403);
    expect((await asReader.post(`/v1/projects/${projectId}/tags`, { name: 'Nope' })).status).toBe(403);
    await asHelper.patch(`/v1/projects/${projectId}/tags/${cut.body.id}`, { name: 'Waterjet' });
    expect((await list(asReader, projectId, 'Releases/v1/frame')).body.entries[0].tags.map((tag: { name: string }) => tag.name)).toEqual(['Steel', 'Waterjet']);
    await asHelper.delete(`/v1/projects/${projectId}/tags/${cut.body.id}`);
    expect((await list(asReader, projectId, 'Branches/dev/frame')).body.entries[0].tags).toEqual([{ id: steel.body.id, name: 'Steel' }]);

    // Favorites are personal, and any reader can keep them.
    expect((await asReader.put(`/v1/projects/${projectId}/items/${railItem}/favorite`, {})).body).toEqual({ favorite: true });
    const favorites = await asReader.get(`/v1/projects/${projectId}/files?favorites=true`);
    expect(favorites.body.total).toBe(2);
    expect(favorites.body.entries.every((file: { favorite: boolean }) => file.favorite)).toBe(true);
    expect((await api.get(`/v1/projects/${projectId}/files?favorites=true`)).body.total).toBe(0);
    expect((await api.get(`/v1/projects/${projectId}/files?q=Rail.SLDPRT`)).body.entries.every((file: { favorite: boolean }) => !file.favorite)).toBe(true);
    await asReader.delete(`/v1/projects/${projectId}/items/${railItem}/favorite`);
    expect((await asReader.get(`/v1/projects/${projectId}/files?favorites=true`)).body.total).toBe(0);

    // Recent files: the newest change first, and paged.
    const recent = await asReader.get(`/v1/projects/${projectId}/files?sort=modified&limit=1`);
    expect(recent.body.entries[0].path).toBe('Rail drawing.PDF');
    expect(recent.body).toMatchObject({ total: 5, nextOffset: 1 });
    const rest = await asReader.get(`/v1/projects/${projectId}/files?sort=modified&limit=10&offset=1`);
    expect(rest.body.entries).toHaveLength(4);
    expect(rest.body.nextOffset).toBeNull();
  });

  it('pages and sorts folder listings', async () => {
    const projectId = await project();
    for (const [name, content] of [['b.txt', 'bb'], ['a.txt', 'aaaa'], ['c.txt', 'c']] as const) {
      await addFile(api, projectId, null, name, content + randomUUID());
    }
    await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId: null, name: 'Zed' });
    const first = await list(api, projectId, '', '&limit=4');
    expect(names(first.body)).toEqual(['Branches', 'Releases', 'Zed', 'a.txt']);
    expect(first.body).toMatchObject({ total: 6, nextOffset: 4 });
    expect(names((await list(api, projectId, '', '&limit=4&offset=4')).body)).toEqual(['b.txt', 'c.txt']);
    expect(names((await list(api, projectId, '', '&sort=modified')).body).slice(3)).toEqual(['c.txt', 'a.txt', 'b.txt']);
  });
});

describe('access', () => {
  it('lets readers browse, contributors change the root, and hides private projects', async () => {
    const projectId = await project();
    const file = await addFile(api, projectId, null, 'Spec.pdf', `spec ${randomUUID()}`);
    expect((await list(asReader, projectId)).body.location.writable).toBe(false);
    expect((await list(asHelper, projectId)).body.location.writable).toBe(true);
    expect((await asReader.post(`/v1/projects/${projectId}/directory/folders`, { parentId: null, name: 'Mine' })).status).toBe(403);
    expect((await asReader.patch(`/v1/projects/${projectId}/directory/entries/${file.body.id}`, { name: 'x.pdf' })).status).toBe(403);
    expect((await asReader.delete(`/v1/projects/${projectId}/directory/entries/${file.body.id}`)).status).toBe(403);
    expect((await list(asStranger, projectId)).status).toBe(404);
    expect((await asStranger.get(`/v1/projects/${projectId}/files?q=spec`)).status).toBe(404);
    expect((await asStranger.put(`/v1/projects/${projectId}/items/${file.body.itemId}/favorite`, {})).status).toBe(404);
    expect((await list(anonymous, projectId)).status).toBe(404);

    // Files and tags of one project can't be reached through another.
    const other = await project();
    const tag = await api.post(`/v1/projects/${other}/tags`, { name: 'Elsewhere' });
    expect((await api.put(`/v1/projects/${projectId}/items/${file.body.itemId}/tags`, { tagIds: [tag.body.id] })).body.error.code).toBe('unknown_tags');
    expect((await api.put(`/v1/projects/${other}/items/${file.body.itemId}/tags`, { tagIds: [tag.body.id] })).status).toBe(404);
    expect((await api.get(`/v1/projects/${other}/directory/entries/${file.body.id}`)).status).toBe(404);
    expect((await api.post(`/v1/projects/${other}/directory/files`, { parentId: null, name: 'Spec.pdf', blob: file.body.blob })).body.error.code).toBe('missing_blobs');
  });

  it('lets anyone browse a public project, and signed-in visitors keep favorites', async () => {
    const projectId = await project('public');
    const file = await addFile(api, projectId, null, 'Readme.txt', `readme ${randomUUID()}`);
    expect(names((await list(anonymous, projectId)).body)).toEqual(['Branches', 'Releases', 'Readme.txt']);
    expect((await list(anonymous, projectId)).body.location.writable).toBe(false);
    expect((await anonymous.put(`/v1/projects/${projectId}/items/${file.body.itemId}/favorite`, {})).status).toBe(401);
    expect((await asStranger.put(`/v1/projects/${projectId}/items/${file.body.itemId}/favorite`, {})).status).toBe(200);
    expect((await asStranger.post(`/v1/projects/${projectId}/directory/folders`, { parentId: null, name: 'Mine' })).status).toBe(403);
    expect((await anonymous.get(`/v1/projects/${projectId}/files?favorites=true`)).body.total).toBe(0);
  });
});

describe('row-level security', () => {
  it('shows directory rows only for projects the database user can read', async () => {
    const [open, closed] = [await project('public'), await project('private')];
    for (const projectId of [open, closed]) {
      const file = await addFile(api, projectId, null, 'Shared.txt', `shared ${randomUUID()}`);
      const tag = await api.post(`/v1/projects/${projectId}/tags`, { name: 'Tagged' });
      await api.put(`/v1/projects/${projectId}/items/${file.body.itemId}/tags`, { tagIds: [tag.body.id] });
      await api.put(`/v1/projects/${projectId}/items/${file.body.itemId}/favorite`, {});
    }
    const visible = await harness.sql.begin(async (tx) => {
      await tx`set local role anon`;
      const count = async (table: string) =>
        (await tx<{ projectId: string }[]>`select project_id from ${tx(table)} where project_id = any(${[open, closed]}::uuid[])`).map((row) => row.projectId);
      return {
        entries: await count('directory_entries'),
        revisions: await count('root_file_revisions'),
        tags: await count('project_tags'),
        fileTags: await count('file_tags'),
        favorites: await count('file_favorites'),
      };
    });
    expect(visible).toEqual({ entries: [open], revisions: [open], tags: [open], fileTags: [open], favorites: [] });
  });
});

describe('storage', () => {
  it('counts root files toward storage, keeps every revision stored, and releases them on delete', async () => {
    const projectId = await project();
    const folder = await api.post(`/v1/projects/${projectId}/directory/folders`, { parentId: null, name: 'Stuff' });
    const first = `first ${randomUUID()}`;
    const added = await addFile(api, projectId, folder.body.id, 'Part.stl', first);
    const [secondBlob] = (await upload(harness, api, projectId, [`second ${randomUUID()}`])) as [string];
    await api.post(`/v1/projects/${projectId}/directory/entries/${added.body.id}/revisions`, { blob: secondBlob });

    const used = async () => (await api.get('/v1/me/billing')).body.usedBytes as number;
    const before = await used();
    expect(before).toBeGreaterThan(0);
    // Uploaded contents in use by a revision are never unlinked, even past the grace period.
    await unlinkUnusedBlobs(harness.sql, { graceHours: 0 });
    const linked = await harness.sql`select 1 from project_blobs where project_id = ${projectId} and sha256 = ${sha256(first)}`;
    expect(linked).toHaveLength(1);
    // A root STL gets a thumbnail queued like a committed one.
    expect(await harness.sql`select 1 from thumbnails where blob_sha256 = ${secondBlob}`).toHaveLength(1);

    const deleted = await api.delete(`/v1/projects/${projectId}/directory/entries/${folder.body.id}`);
    expect(deleted.status).toBe(204);
    expect(await harness.sql`select 1 from items where id = ${added.body.itemId}`).toHaveLength(0);
    await unlinkUnusedBlobs(harness.sql, { graceHours: 0 });
    expect(await used()).toBeLessThan(before);
  });
});
