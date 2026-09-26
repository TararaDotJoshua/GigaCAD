import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, commitVersion, createHarness, createUser, sha256, type Client, type Harness, type TestUser } from './helpers.js';

let harness: Harness;
let maker: TestUser;
let fan: TestUser;
let asMaker: Client;
let asFan: Client;
let anonymous: Client;
let publicId: string;
let publicSlug: string;
let privateId: string;
const word = randomUUID().slice(0, 8);

async function releasedProject(api: Client, visibility: 'public' | 'private', files: Record<string, string>) {
  const slug = `share-${randomUUID().slice(0, 8)}`;
  const created = await api.post('/v1/projects', { slug, name: `Gearbox ${word}`, description: 'A two-stage gearbox', visibility });
  const projectId = created.body.id as string;
  const branch = await api.post(`/v1/projects/${projectId}/branches`, { name: 'initial' });
  await commitVersion(harness, api, projectId, branch.body.id, files);
  const opened = await api.post(`/v1/branches/${branch.body.id}/release-requests`, { title: 'v1' });
  const requestId = opened.body.releaseRequest.id;
  await api.post(`/v1/release-requests/${requestId}/candidate`);
  await api.post(`/v1/release-requests/${requestId}/approvals`);
  expect((await api.post(`/v1/release-requests/${requestId}/release`)).status).toBe(201);
  return { projectId, slug };
}

beforeAll(async () => {
  harness = await createHarness();
  [maker, fan] = await Promise.all([createUser(harness, 'maker'), createUser(harness, 'fan')]);
  asMaker = client(harness, maker);
  asFan = client(harness, fan);
  anonymous = client(harness, null);
  ({ projectId: publicId, slug: publicSlug } = await releasedProject(asMaker, 'public', {
    'Gearbox.SLDASM': `asm ${word}`,
    'parts/Gear.SLDPRT': `gear ${word}`,
  }));
  ({ projectId: privateId } = await releasedProject(asMaker, 'private', { 'Secret.SLDPRT': `secret ${word}` }));
});

afterAll(async () => {
  await harness?.close();
});

describe('explore', () => {
  it('lists public projects to anyone, never private ones', async () => {
    const found = await anonymous.get(`/v1/explore?q=${word}&sort=recent`);
    expect(found.status).toBe(200);
    expect(found.body.map((project: { id: string }) => project.id)).toEqual([publicId]);
    expect(found.body[0]).toMatchObject({ ownerHandle: maker.handle, latestReleaseNumber: 1, starCount: 0 });
  });

  it('matches owners too, and treats search text literally', async () => {
    expect((await anonymous.get(`/v1/explore?q=${maker.handle}`)).body.some((project: { id: string }) => project.id === publicId)).toBe(true);
    expect((await anonymous.get('/v1/explore?q=%25')).status).toBe(200);
  });
});

describe('stars', () => {
  it('counts stars and shows whether you starred', async () => {
    expect((await anonymous.put(`/v1/projects/${publicId}/star`, {})).status).toBe(401);
    expect((await asFan.put(`/v1/projects/${publicId}/star`, {})).body).toEqual({ starred: true, starCount: 1 });
    expect((await asFan.put(`/v1/projects/${publicId}/star`, {})).body.starCount).toBe(1);
    expect((await asFan.get(`/v1/projects/${publicId}`)).body).toMatchObject({ starred: true, starCount: 1 });
    expect((await asMaker.get(`/v1/projects/${publicId}`)).body).toMatchObject({ starred: false, starCount: 1 });
    expect((await anonymous.get(`/v1/explore?q=${word}`)).body[0].starCount).toBe(1);
    expect((await asFan.delete(`/v1/projects/${publicId}/star`)).body).toEqual({ starred: false, starCount: 0 });
  });

  it("can't star a private project you can't see", async () => {
    expect((await asFan.put(`/v1/projects/${privateId}/star`, {})).status).toBe(404);
  });
});

describe('profiles', () => {
  it('shows public projects to others and everything to yourself', async () => {
    const seen = await anonymous.get(`/v1/users/${maker.handle}`);
    expect(seen.status).toBe(200);
    expect(seen.body.profile).toMatchObject({ handle: maker.handle });
    expect(seen.body.profile.id).toBeUndefined();
    expect(seen.body.projects.map((project: { id: string }) => project.id)).toEqual([publicId]);
    const own = await asMaker.get(`/v1/users/${maker.handle}`);
    expect(own.body.projects.map((project: { id: string }) => project.id).sort()).toEqual([publicId, privateId].sort());
    expect((await anonymous.get('/v1/users/nobody-here-at-all')).status).toBe(404);
  });
});

describe('forks', () => {
  it('copies a release into a new project as v1, with new item IDs and the same files', async () => {
    const forked = await asFan.post(`/v1/projects/${publicId}/forks`, { slug: `my-gearbox-${word}`, name: 'My gearbox' });
    expect(forked.status).toBe(201);
    expect(forked.body).toMatchObject({
      ownerHandle: fan.handle,
      visibility: 'public',
      latestReleaseNumber: 1,
      role: 'owner',
      forkedFrom: { ownerHandle: maker.handle, slug: publicSlug, releaseNumber: 1 },
    });

    const source = await asFan.get(`/v1/projects/${publicId}/releases/1`);
    const copy = await asFan.get(`/v1/projects/${forked.body.id}/releases/1`);
    expect(copy.body.files.map((file: { path: string; blob: string }) => [file.path, file.blob])).toEqual(
      source.body.files.map((file: { path: string; blob: string }) => [file.path, file.blob]),
    );
    const sourceItems = new Set(source.body.files.map((file: { itemId: string }) => file.itemId));
    expect(copy.body.files.every((file: { itemId: string }) => !sourceItems.has(file.itemId))).toBe(true);
    expect(copy.body.notes ?? copy.body.release?.notes).toContain(`@${maker.handle}/${publicSlug} v1`);

    // The fork's files download, count against the fan's storage, and the source shows the fork.
    const downloads = await asFan.post(`/v1/projects/${forked.body.id}/blobs/downloads`, { sha256s: [sha256(`gear ${word}`)] });
    expect(downloads.body.missing).toEqual([]);
    expect((await asFan.get('/v1/me/billing')).body.usedBytes).toBeGreaterThanOrEqual(Buffer.byteLength(`asm ${word}gear ${word}`));
    expect((await anonymous.get(`/v1/projects/${publicId}`)).body.forkCount).toBe(1);
  });

  it('keeps forks of private projects private, and hides them from outsiders', async () => {
    expect((await asFan.post(`/v1/projects/${privateId}/forks`, { slug: `nope-${word}`, name: 'Nope' })).status).toBe(404);
    expect((await asMaker.post(`/v1/projects/${privateId}/forks`, { slug: `leak-${word}`, name: 'Leak', visibility: 'public' })).status).toBe(403);
    const kept = await asMaker.post(`/v1/projects/${privateId}/forks`, { slug: `copy-${word}`, name: 'Copy' });
    expect(kept.status).toBe(201);
    expect(kept.body.visibility).toBe('private');
  });

  it('needs a release to fork, and a free slug', async () => {
    const empty = await asMaker.post('/v1/projects', { slug: `empty-${word}`, name: 'Empty', visibility: 'public' });
    expect((await asFan.post(`/v1/projects/${empty.body.id}/forks`, { slug: `e-${word}`, name: 'E' })).status).toBe(422);
    expect((await asFan.post(`/v1/projects/${publicId}/forks`, { slug: `my-gearbox-${word}`, name: 'Again' })).status).toBe(409);
    expect((await asFan.post(`/v1/projects/${publicId}/forks`, { slug: `v9-${word}`, name: 'V9', releaseNumber: 9 })).status).toBe(404);
  });
});
