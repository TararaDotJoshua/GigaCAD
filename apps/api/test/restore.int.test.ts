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

  it('keeps the address reserved while the project is deleted, and says so', async () => {
    const project = await newProject();
    const live = (await api.post('/v1/projects', { slug: project.slug, name: 'Twin' })).body.error;
    expect(live.code).toBe('address_taken');
    await api.delete(`/v1/projects/${project.id}`);
    const taken = await api.post('/v1/projects', { slug: project.slug, name: 'Taken' });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatchObject({ code: 'address_deleted', details: { projectId: project.id } });
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

  it('refuses a restore that would go past the storage limit', async () => {
    // Its own account, so the lowered limit doesn't reach the other tests.
    const tight = await createUser(harness, 'tight');
    const as = client(harness, tight);
    const create = async (name: string) => {
      const project = await as.post('/v1/projects', { slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`, name });
      const branch = await as.post(`/v1/projects/${project.body.id}/branches`, { name: 'work' });
      return { id: project.body.id as string, branchId: branch.body.id as string };
    };
    const deleted = await create('Deleted');
    const kept = `kept ${randomUUID()}`;
    const freed = `freed ${randomUUID()}`;
    // One file it shares with a live project costs nothing to bring back; the other does.
    await commitVersion(harness, as, deleted.id, deleted.branchId, { 'Kept.SLDPRT': kept, 'Freed.SLDPRT': freed });
    expect((await as.delete(`/v1/projects/${deleted.id}`)).status).toBe(204);

    // The freed space goes to another project.
    const live = await create('Live');
    await commitVersion(harness, as, live.id, live.branchId, { 'Kept.SLDPRT': kept, 'New.SLDPRT': `new ${randomUUID()}` });
    const usedNow = (await as.get('/v1/me/billing')).body.usedBytes as number;
    await harness.sql`update profiles set quota_bytes = ${usedNow + Buffer.byteLength(freed) - 1} where id = ${tight.id}`;

    const refused = await as.post(`/v1/projects/${deleted.id}/restore`);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatchObject({ code: 'storage_full', details: { neededBytes: Buffer.byteLength(freed) } });
    expect(await deletedIds(as)).toContain(deleted.id);
    expect((await as.get('/v1/me/billing')).body.usedBytes).toBe(usedNow);

    await harness.sql`update profiles set quota_bytes = ${usedNow + Buffer.byteLength(freed)} where id = ${tight.id}`;
    expect((await as.post(`/v1/projects/${deleted.id}/restore`)).status).toBe(200);
    expect((await as.get('/v1/me/billing')).body.usedBytes).toBe(usedNow + Buffer.byteLength(freed));
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
