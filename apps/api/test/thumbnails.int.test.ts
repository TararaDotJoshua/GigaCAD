import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteOrphanBlobs, purgeDeletedProjects, unlinkUnusedBlobs } from '../src/jobs.js';
import { thumbnailKey } from '../src/storage.js';
import { inlineRenderer } from '../src/thumbnails/index.js';
import { generateThumbnails } from '../src/thumbnails/job.js';
import { client, commitVersion, createHarness, createUser, sha256, type Client, type Harness, type TestUser } from './helpers.js';

let harness: Harness;
let owner: TestUser;
let api: Client;
let outsider: Client;

beforeAll(async () => {
  harness = await createHarness();
  owner = await createUser(harness, 'renderer');
  api = client(harness, owner);
  outsider = client(harness, await createUser(harness, 'stranger'));
});

afterAll(async () => {
  await harness?.close();
});

/** An ASCII STL tetrahedron, made unique so each test has its own file. */
function tetrahedron(): string {
  const tag = randomUUID();
  const facet = (a: string, b: string, c: string) => `facet normal 0 0 0\nouter loop\nvertex ${a}\nvertex ${b}\nvertex ${c}\nendloop\nendfacet`;
  return [`solid ${tag}`, facet('0 0 0', '10 0 0', '0 10 0'), facet('0 0 0', '0 0 10', '10 0 0'), facet('0 0 0', '0 10 0', '0 0 10'), facet('10 0 0', '0 0 10', '0 10 0'), `endsolid ${tag}`].join('\n');
}

async function projectWith(files: Record<string, string>, visibility: 'public' | 'private' = 'private') {
  const slug = `thumbs-${randomUUID().slice(0, 8)}`;
  const created = await api.post('/v1/projects', { slug, name: `Thumbs ${slug}`, visibility });
  const branch = await api.post(`/v1/projects/${created.body.id}/branches`, { name: 'work' });
  await commitVersion(harness, api, created.body.id, branch.body.id, files);
  return created.body.id as string;
}

const statusOf = async (content: string) =>
  (await harness.sql<{ status: string; error: string | null }[]>`select status, error from thumbnails where blob_sha256 = ${sha256(content)}`)[0];
const render = () => generateThumbnails({ sql: harness.sql, storage: harness.storage, renderer: inlineRenderer }, { budgetMs: 30_000 });

describe('thumbnails', () => {
  it('are queued for 3D files when committed, rendered, and linked for people who can see the project', async () => {
    const stl = tetrahedron();
    const part = `part ${randomUUID()}`;
    const projectId = await projectWith({ 'parts/bracket.stl': stl, 'parts/Bracket.SLDPRT': part });
    expect(await statusOf(stl)).toMatchObject({ status: 'pending' });
    expect(await statusOf(part)).toBeUndefined();

    const waiting = await api.post(`/v1/projects/${projectId}/thumbnails`, { sha256s: [sha256(stl)] });
    expect(waiting.body).toEqual({ thumbnails: {}, pending: [sha256(stl)] });

    expect(await render()).toBeGreaterThanOrEqual(1);
    expect(await statusOf(stl)).toMatchObject({ status: 'ready', error: null });
    expect(harness.storage.objects.get(thumbnailKey(sha256(stl)))?.subarray(1, 4).toString()).toBe('PNG');

    const links = await api.post(`/v1/projects/${projectId}/thumbnails`, { sha256s: [sha256(stl), sha256(part)] });
    expect(links.status).toBe(200);
    expect(Object.keys(links.body.thumbnails)).toEqual([sha256(stl)]);
    expect(links.body.thumbnails[sha256(stl)]).toContain(thumbnailKey(sha256(stl)));
    expect((await outsider.post(`/v1/projects/${projectId}/thumbnails`, { sha256s: [sha256(stl)] })).status).toBe(404);

    // A project can't read another project's thumbnails by guessing hashes.
    const otherId = await projectWith({ 'Other.SLDPRT': `other ${randomUUID()}` });
    expect((await api.post(`/v1/projects/${otherId}/thumbnails`, { sha256s: [sha256(stl)] })).body.thumbnails).toEqual({});
  });

  it('give public projects a cover on Explore and profiles', async () => {
    const stl = tetrahedron();
    const projectId = await projectWith({ 'Model.stl': stl, 'Notes.txt': `notes ${randomUUID()}` }, 'public');
    const before = await client(harness, null).get(`/v1/users/${owner.handle}`);
    expect(before.body.projects.find((project: { id: string }) => project.id === projectId).thumbnailUrl).toBeNull();

    await render();
    const after = await client(harness, null).get(`/v1/users/${owner.handle}`);
    expect(after.body.projects.find((project: { id: string }) => project.id === projectId).thumbnailUrl).toContain(thumbnailKey(sha256(stl)));
    const explore = await client(harness, null).get('/v1/explore?sort=recent&limit=100');
    expect(explore.body.find((project: { id: string }) => project.id === projectId)).toMatchObject({ thumbnailUrl: expect.stringContaining('.png') });
  });

  it('fail for files that cannot be read, and skip files that are too large', async () => {
    const broken = `solid broken ${randomUUID()}\nnothing here\nendsolid`;
    const huge = tetrahedron();
    await projectWith({ 'broken.stl': broken, 'huge.stl': huge });
    await harness.sql`update blobs set size = ${200 * 1024 ** 2} where sha256 = ${sha256(huge)}`;
    await render();
    expect(await statusOf(broken)).toMatchObject({ status: 'failed', error: 'This STL file couldn’t be read.' });
    expect(await statusOf(huge)).toMatchObject({ status: 'skipped', error: 'This file is too large to preview.' });
  });

  it('are removed with the file they belong to', async () => {
    const stl = tetrahedron();
    const projectId = await projectWith({ 'gone.stl': stl });
    await render();
    expect(harness.storage.objects.has(thumbnailKey(sha256(stl)))).toBe(true);

    // Once nothing uses the file anymore, cleanup removes it and its thumbnail.
    await api.delete(`/v1/projects/${projectId}`);
    await harness.sql`update projects set deleted_at = now() - interval '31 days' where id = ${projectId}`;
    await purgeDeletedProjects(harness.sql);
    await unlinkUnusedBlobs(harness.sql, { graceHours: 0 });
    await deleteOrphanBlobs(harness.sql, harness.storage, { graceHours: 0 });
    expect(await statusOf(stl)).toBeUndefined();
    expect(harness.storage.objects.has(thumbnailKey(sha256(stl)))).toBe(false);
  });
});
