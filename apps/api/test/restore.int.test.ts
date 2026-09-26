import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, commitVersion, createHarness, createUser, type Client, type Harness, type TestUser } from './helpers.js';

let harness: Harness;
let owner: TestUser;
let maintainer: TestUser;
let api: Client;
let other: Client;

beforeAll(async () => {
  harness = await createHarness();
  owner = await createUser(harness, 'restorer');
  maintainer = await createUser(harness, 'helper');
  api = client(harness, owner);
  other = client(harness, maintainer);
});

afterAll(async () => {
  await harness?.close();
});

async function newProject() {
  const slug = `restore-${randomUUID().slice(0, 8)}`;
  const response = await api.post('/v1/projects', { slug, name: 'Restore me' });
  expect(response.status).toBe(201);
  return { id: response.body.id as string, slug };
}

const deletedIds = async (as: Client) => ((await as.get('/v1/me/deleted-projects')).body as { id: string }[]).map((project) => project.id);
const used = async () => (await api.get('/v1/me/billing')).body.usedBytes as number;

describe('restoring deleted projects', () => {
  it('brings a project back with its history, members, and storage', async () => {
    const project = await newProject();
    await api.put(`/v1/projects/${project.id}/members`, { handle: maintainer.handle, role: 'maintainer' });
    const branch = await api.post(`/v1/projects/${project.id}/branches`, { name: 'work' });
    const content = `part ${randomUUID()}`;
    await commitVersion(harness, api, project.id, branch.body.id, { 'Part.SLDPRT': content });
    const before = await used();

    expect((await api.delete(`/v1/projects/${project.id}`)).status).toBe(204);
    expect(await used()).toBe(before - Buffer.byteLength(content));
    expect((await api.get(`/v1/projects/${project.id}`)).status).toBe(404);
    const listed = (await api.get('/v1/me/deleted-projects')).body.find((item: { id: string }) => item.id === project.id);
    expect(listed).toMatchObject({ slug: project.slug, name: 'Restore me', ownerHandle: owner.handle });
    expect(new Date(listed.purgeAt).getTime() - new Date(listed.deletedAt).getTime()).toBe(30 * 86_400_000);

    const restored = await api.post(`/v1/projects/${project.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ id: project.id, slug: project.slug, role: 'owner' });
    expect(await deletedIds(api)).not.toContain(project.id);
    expect(await used()).toBe(before);
    expect((await other.get(`/v1/projects/${project.id}`)).body.role).toBe('maintainer');
    const branches = await api.get(`/v1/projects/${project.id}/branches`);
    expect(branches.body.map((item: { name: string }) => item.name)).toContain('work');
  });

  it('keeps the address reserved while the project is deleted', async () => {
    const project = await newProject();
    await api.delete(`/v1/projects/${project.id}`);
    expect((await api.post('/v1/projects', { slug: project.slug, name: 'Taken' })).status).toBe(409);
  });

  it('lets only the owner see and restore a deleted project', async () => {
    const project = await newProject();
    await api.put(`/v1/projects/${project.id}/members`, { handle: maintainer.handle, role: 'maintainer' });
    await api.delete(`/v1/projects/${project.id}`);

    expect(await deletedIds(other)).not.toContain(project.id);
    expect((await other.post(`/v1/projects/${project.id}/restore`)).status).toBe(404);
    expect((await client(harness, null).post(`/v1/projects/${project.id}/restore`)).status).toBe(401);
    expect((await api.post(`/v1/projects/${randomUUID()}/restore`)).status).toBe(404);
  });

  it('refuses a project that is not deleted, or past its 30 days', async () => {
    const live = await newProject();
    expect((await api.post(`/v1/projects/${live.id}/restore`)).status).toBe(404);

    const old = await newProject();
    await api.delete(`/v1/projects/${old.id}`);
    await harness.sql`update projects set deleted_at = now() - interval '31 days' where id = ${old.id}`;
    expect(await deletedIds(api)).not.toContain(old.id);
    expect((await api.post(`/v1/projects/${old.id}/restore`)).status).toBe(404);
  });
});
