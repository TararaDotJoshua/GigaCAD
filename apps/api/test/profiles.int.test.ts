import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, commitVersion, createHarness, createUser, MACHINE, upload, type Client, type Harness, type TestUser } from './helpers.js';

let harness: Harness;
let maker: TestUser;
let member: TestUser;
let asMaker: Client;
let asMember: Client;
let anonymous: Client;
let publicId: string;
let privateId: string;
const word = randomUUID().slice(0, 8);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** A project with one version commit, a release request, an approval, and a release: four contributions. */
async function releasedProject(api: Client, visibility: 'public' | 'private') {
  const slug = `profile-${randomUUID().slice(0, 8)}`;
  const created = await api.post('/v1/projects', { slug, name: `Profile ${word}`, visibility });
  const projectId = created.body.id as string;
  const branch = await api.post(`/v1/projects/${projectId}/branches`, { name: 'initial' });
  await commitVersion(harness, api, projectId, branch.body.id, { 'Part.SLDPRT': `${visibility} ${word}` });
  const opened = await api.post(`/v1/branches/${branch.body.id}/release-requests`, { title: `First ${visibility} release` });
  const requestId = opened.body.releaseRequest.id;
  await api.post(`/v1/release-requests/${requestId}/candidate`);
  await api.post(`/v1/release-requests/${requestId}/approvals`);
  expect((await api.post(`/v1/release-requests/${requestId}/release`)).status).toBe(201);
  return projectId;
}

async function putAvatar(user: TestUser, body: Buffer, contentType = 'image/png') {
  const response = await harness.app.inject({
    method: 'PUT',
    url: '/v1/me/avatar',
    headers: { authorization: `Bearer ${user.token}`, 'content-type': contentType },
    payload: body,
  });
  return { status: response.statusCode, body: response.body ? response.json() : undefined };
}

const today = () => new Date().toISOString().slice(0, 10);
const total = (days: { count: number }[]) => days.reduce((sum, day) => sum + day.count, 0);

beforeAll(async () => {
  harness = await createHarness();
  [maker, member] = await Promise.all([createUser(harness, 'maker'), createUser(harness, 'member')]);
  asMaker = client(harness, maker);
  asMember = client(harness, member);
  anonymous = client(harness, null);
  publicId = await releasedProject(asMaker, 'public');
  privateId = await releasedProject(asMaker, 'private');
  await asMaker.put(`/v1/projects/${privateId}/members`, { handle: member.handle, role: 'viewer' });

  // An autosave on a new branch of the public project, which shouldn't count.
  const branch = await asMaker.post(`/v1/projects/${publicId}/branches`, { name: 'autosaves' });
  const checkout = await asMaker.post(`/v1/branches/${branch.body.id}/checkout`, { machine: MACHINE });
  const [blob] = await upload(harness, asMaker, publicId, [`autosave ${word}`]);
  const saved = await asMaker.post(`/v1/branches/${branch.body.id}/commits`, {
    parentId: checkout.body.headCommitId,
    machine: MACHINE,
    kind: 'autosave',
    files: [{ path: 'Part.SLDPRT', blob }],
  });
  expect(saved.status).toBe(201);
});

afterAll(async () => {
  await harness?.close();
});

describe('contributions', () => {
  it('counts version commits, release requests, releases, and approvals on the UTC day, but not autosaves', async () => {
    const page = await anonymous.get(`/v1/users/${maker.handle}`);
    expect(page.status).toBe(200);
    expect(page.body.contributions).toEqual([{ day: today(), count: 4 }]);
    expect(page.body.activity.map((item: { kind: string }) => item.kind).sort()).toEqual(['approval', 'commit', 'release', 'release_request']);
    expect(page.body.activity[0]).toMatchObject({ ownerHandle: maker.handle, projectName: `Profile ${word}` });
    const commit = page.body.activity.find((item: { kind: string }) => item.kind === 'commit');
    expect(commit).toMatchObject({ branchName: 'initial', title: 'test' });
    expect(commit.commitId).toEqual(expect.any(String));
  });

  it('shows private-project contributions to members and the user, never to strangers', async () => {
    expect(total((await asMaker.get(`/v1/users/${maker.handle}`)).body.contributions)).toBe(8);
    const seenByMember = (await asMember.get(`/v1/users/${maker.handle}`)).body;
    expect(total(seenByMember.contributions)).toBe(8);
    expect(seenByMember.activity.some((item: { title: string | null }) => item.title === 'First private release')).toBe(true);
    const seenByStranger = (await anonymous.get(`/v1/users/${maker.handle}`)).body;
    expect(seenByStranger.activity.some((item: { title: string | null }) => item.title === 'First private release')).toBe(false);
  });
});

describe('stars', () => {
  it('lists starred projects the viewer can read', async () => {
    await asMember.put(`/v1/projects/${publicId}/star`, {});
    await asMember.put(`/v1/projects/${privateId}/star`, {});
    const ids = (response: { body: { id: string }[] }) => response.body.map((project) => project.id).sort();
    expect(ids(await anonymous.get(`/v1/users/${member.handle}/stars`))).toEqual([publicId]);
    expect(ids(await asMember.get(`/v1/users/${member.handle}/stars`))).toEqual([publicId, privateId].sort());
    expect((await anonymous.get(`/v1/users/${member.handle}`)).body.profile.starCount).toBe(1);
    expect((await anonymous.get('/v1/users/nobody-here-at-all/stars')).status).toBe(404);
  });
});

describe('profile details', () => {
  it('saves a bio, location, and website, and clears them with empty text', async () => {
    const saved = await asMaker.patch('/v1/me', { bio: '  Builds gearboxes.  ', location: 'Denver', website: 'https://example.com/me' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ bio: 'Builds gearboxes.', location: 'Denver', website: 'https://example.com/me', avatarUrl: null });
    expect((await anonymous.get(`/v1/users/${maker.handle}`)).body.profile).toMatchObject({ bio: 'Builds gearboxes.', website: 'https://example.com/me' });
    expect((await asMaker.patch('/v1/me', { location: '' })).body.location).toBeNull();
  });

  it('only takes http and https links', async () => {
    for (const website of ['javascript:alert(1)', 'ftp://example.com', 'example.com']) {
      expect((await asMaker.patch('/v1/me', { website })).status).toBe(400);
    }
    expect((await asMaker.patch('/v1/me', { bio: 'x'.repeat(161) })).status).toBe(400);
  });
});

describe('avatars', () => {
  it('stores an image, replaces it, and removes it', async () => {
    const first = await putAvatar(maker, PNG);
    expect(first.status).toBe(200);
    const firstKey = [...harness.storage.objects.keys()].find((key) => key.startsWith(`avatars/`) && first.body.avatarUrl.includes(key))!;
    expect(firstKey).toBeDefined();
    expect((await asMaker.get('/v1/me')).body.avatarUrl).toBe(first.body.avatarUrl);
    expect((await anonymous.get(`/v1/users/${maker.handle}`)).body.profile.avatarUrl).toBe(first.body.avatarUrl);

    const second = await putAvatar(maker, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'image/jpeg');
    expect(second.status).toBe(200);
    expect(harness.storage.objects.has(firstKey)).toBe(false);

    expect((await asMaker.delete('/v1/me/avatar')).status).toBe(204);
    expect((await asMaker.get('/v1/me')).body.avatarUrl).toBeNull();
    expect([...harness.storage.objects.keys()].some((key) => key.startsWith(`avatars/`) && second.body.avatarUrl.includes(key))).toBe(false);
  });

  it('rejects files that are not images, and images over 1 MB', async () => {
    expect((await putAvatar(maker, Buffer.from('not really a png'))).status).toBe(400);
    expect((await putAvatar(maker, Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))).status).toBe(413);
    expect((await putAvatar(maker, PNG, 'text/plain')).status).toBe(400);
  });
});

describe('deleted projects', () => {
  it("drop out of the user's contributions", async () => {
    expect((await asMaker.delete(`/v1/projects/${privateId}`)).status).toBe(204);
    expect(total((await asMaker.get(`/v1/users/${maker.handle}`)).body.contributions)).toBe(4);
  });
});
