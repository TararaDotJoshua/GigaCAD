import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { crc32, encodePng } from '../src/thumbnails/png.js';
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

const PNG = encodePng(2, 2, new Uint8Array(16).fill(200));
/** The smallest JPEG structure the check accepts: a frame header, a scan, and the end marker. */
const JPEG = Buffer.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34,
  0xff, 0xd9,
]);

/** A project with one version commit, a release request, an approval, and a release: four contributions. */
async function releasedProject(api: Client, visibility: 'public' | 'private') {
  const slug = `profile-${randomUUID().slice(0, 8)}`;
  const created = await api.post('/v1/projects', { slug, name: `Profile ${word}`, visibility });
  const projectId = created.body.id as string;
  const branch = await api.post(`/v1/projects/${projectId}/branches`, { name: 'initial' });
  await commitVersion(harness, api, projectId, branch.body.id, { 'Part.SLDPRT': `${visibility} ${word}` });
  const opened = await api.post(`/v1/branches/${branch.body.id}/release-requests`, { title: `First ${visibility} release` });
  const requestId = opened.body.releaseRequest.id;
  const candidateManifestId = (await api.post(`/v1/release-requests/${requestId}/candidate`)).body.candidate.manifestId;
  await api.post(`/v1/release-requests/${requestId}/approvals`, { candidateManifestId });
  expect((await api.post(`/v1/release-requests/${requestId}/release`, { candidateManifestId })).status).toBe(201);
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

  it('gives one message per problem, naming the field', async () => {
    const problems = async (body: object) => ((await asMaker.patch('/v1/me', body)).body.error.details as { message: string }[]).map((item) => item.message);
    expect(await problems({ website: 'javascript:alert(1)' })).toEqual(['Use a link that starts with http:// or https://']);
    expect(await problems({ website: `https://${'a'.repeat(200)}.com` })).toEqual(['Website can be at most 200 characters']);
    expect(await problems({ bio: 'x'.repeat(161) })).toEqual(['Bio can be at most 160 characters']);
  });

  it('takes a scheme in any case and a host with a port', async () => {
    expect((await asMaker.patch('/v1/me', { website: 'Https://Example.com/Me' })).body.website).toBe('https://Example.com/Me');
    expect((await asMaker.patch('/v1/me', { website: 'https://example.com:8080' })).body.website).toBe('https://example.com:8080');
  });

  it('counts a bio as the form does: line breaks once, emoji by what they are made of', async () => {
    // Three lines filling the 160 the counter allows, sent as a form sends them, with CRLF.
    const lines = ['a'.repeat(52), 'b'.repeat(52), 'c'.repeat(54)];
    const saved = await asMaker.patch('/v1/me', { bio: lines.join('\r\n') });
    expect(saved.status).toBe(200);
    expect(saved.body.bio).toBe(lines.join('\n'));
    // A family emoji is 11 UTF-16 units but 7 characters.
    expect((await asMaker.patch('/v1/me', { bio: `${'x'.repeat(153)}👨‍👩‍👧‍👦` })).status).toBe(200);
    // Runs of blank lines become one.
    expect((await asMaker.patch('/v1/me', { bio: 'one\n\n\n\ntwo' })).body.bio).toBe('one\n\ntwo');
  });

  it('says when a handle belongs to someone else', async () => {
    const taken = await asMaker.patch('/v1/me', { handle: member.handle });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('handle_taken');
    expect((await asMaker.patch('/v1/me', { handle: maker.handle })).status).toBe(200);
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

    const second = await putAvatar(maker, JPEG, 'image/jpeg');
    expect(second.status).toBe(200);
    expect(harness.storage.objects.has(firstKey)).toBe(false);

    expect((await asMaker.delete('/v1/me/avatar')).status).toBe(204);
    expect((await asMaker.get('/v1/me')).body.avatarUrl).toBeNull();
    expect([...harness.storage.objects.keys()].some((key) => key.startsWith(`avatars/`) && second.body.avatarUrl.includes(key))).toBe(false);
  });

  it('rejects files that are not images, and images over 1 MB', async () => {
    expect((await putAvatar(maker, Buffer.from('not really a png'))).status).toBe(400);
    // Only the first bytes of an image, then garbage.
    const corrupt = await putAvatar(maker, Buffer.concat([PNG.subarray(0, 8), Buffer.from('garbage that is not a png chunk at all')]));
    expect(corrupt.status).toBe(400);
    expect(corrupt.body.error.code).toBe('invalid_image');
    expect((await putAvatar(maker, Buffer.concat([JPEG.subarray(0, 4), Buffer.from('xx')]), 'image/jpeg')).status).toBe(400);
    expect((await putAvatar(maker, Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))).status).toBe(413);
    expect((await putAvatar(maker, PNG, 'text/plain')).status).toBe(400);
  });
});

describe('avatar uploads that try to exhaust the API', () => {
  it('refuses a small PNG that would inflate to gigabytes, without storing it', async () => {
    const bomber = await createUser(harness, 'bomber');
    // A 1x1 image whose pixel data is 256 MB of zeros: about 250 KB compressed.
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 6;
    const chunk = (name: string, data: Uint8Array) => {
      const out = Buffer.alloc(12 + data.length);
      out.writeUInt32BE(data.length, 0);
      out.write(name, 4, 'ascii');
      out.set(data, 8);
      out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
      return out;
    };
    const bomb = Buffer.concat([PNG.subarray(0, 8), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(256 * 1024 * 1024))), chunk('IEND', Buffer.alloc(0))]);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const keys = harness.storage.objects.size;
    const started = performance.now();
    const refused = await putAvatar(bomber, bomb);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('invalid_image');
    expect(harness.storage.objects.size).toBe(keys);
  });

  it('limits how often one account can upload', async () => {
    const eager = await createUser(harness, 'eager');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await putAvatar(eager, PNG)).status);
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('deleted projects', () => {
  it("drop out of the user's contributions", async () => {
    expect((await asMaker.delete(`/v1/projects/${privateId}`)).status).toBe(204);
    expect(total((await asMaker.get(`/v1/users/${maker.handle}`)).body.contributions)).toBe(4);
  });
});
