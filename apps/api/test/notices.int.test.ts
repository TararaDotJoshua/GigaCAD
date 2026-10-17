import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Mailer } from '../src/mail.js';
import { client, commitVersion, createHarness, createUser, type Client, type Harness, type TestUser } from './helpers.js';

// Who hears about changes made to their access and work, and what the activity feed records.

let harness: Harness;
let owner: TestUser;
let maintainer: TestUser;
let contributor: TestUser;
let asOwner: Client;
let asMaintainer: Client;
let asContributor: Client;
let projectId: string;
let name: string;
const sent: Parameters<Mailer['send']>[0][] = [];
const about = (text: string) => sent.filter((message) => message.subject.includes(text));

beforeAll(async () => {
  harness = await createHarness({ mailer: { send: async (message) => void sent.push(message) } });
  [owner, maintainer, contributor] = await Promise.all([createUser(harness, 'owner'), createUser(harness, 'maint'), createUser(harness, 'contrib')]);
  asOwner = client(harness, owner);
  asMaintainer = client(harness, maintainer);
  asContributor = client(harness, contributor);
  name = `Notice bench ${randomUUID().slice(0, 6)}`;
  const created = await asOwner.post('/v1/projects', { slug: `notice-${randomUUID().slice(0, 8)}`, name, visibility: 'private' });
  projectId = created.body.id;
  await asOwner.put(`/v1/projects/${projectId}/members`, { handle: maintainer.handle, role: 'maintainer' });
  await asOwner.put(`/v1/projects/${projectId}/members`, { handle: contributor.handle, role: 'contributor' });
  await asOwner.put(`/v1/projects/${projectId}/approval-rules`, { requiredCount: 1, approverRoles: ['maintainer'], approverUserIds: [], allowSelfApproval: false, requireCleanRebuild: false });
});

afterAll(async () => {
  await harness?.close();
});

const events = async (query = 'order=desc&limit=50') => (await asOwner.get(`/v1/projects/${projectId}/events?${query}`)).body as { id: string; kind: string; actorHandle: string | null; payload: any }[];

describe('release request notices', () => {
  let requestId: string;

  it('tells the people who can approve a new candidate, not the requester', async () => {
    const branch = await asContributor.post(`/v1/projects/${projectId}/branches`, { name: 'wider' });
    await commitVersion(harness, asContributor, projectId, branch.body.id, { 'Bench.SLDASM': `wide ${randomUUID()}` });
    const opened = await asContributor.post(`/v1/branches/${branch.body.id}/release-requests`, { title: '  Wider bench  ' });
    expect(opened.status).toBe(201);
    // Titles are trimmed, so one of only spaces can't get in.
    expect(opened.body.releaseRequest.title).toBe('Wider bench');
    expect((await asContributor.post(`/v1/branches/${branch.body.id}/release-requests`, { title: '   ' })).status).toBe(400);
    requestId = opened.body.releaseRequest.id;
    await asContributor.post(`/v1/release-requests/${requestId}/candidate`);

    const reviews = about(`Review #${opened.body.releaseRequest.number} Wider bench`);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.text).toContain('you can approve it');
    expect(reviews[0]!.text).toMatch(/\/release-requests\/\d+$/);

    // Rebuilding right away doesn't email again.
    await asContributor.post(`/v1/release-requests/${requestId}/candidate`);
    expect(about('Review #')).toHaveLength(1);
  });

  it('tells the requester when someone approves or closes it, and records one approval per candidate', async () => {
    const detail = (await asContributor.get(`/v1/release-requests/${requestId}`)).body;
    const body = { candidateManifestId: detail.candidate.manifestId };
    expect((await asMaintainer.post(`/v1/release-requests/${requestId}/approvals`, body)).status).toBe(200);
    expect((await asMaintainer.post(`/v1/release-requests/${requestId}/approvals`, body)).status).toBe(200);
    expect(about(`@${maintainer.handle} approved`)).toHaveLength(1);
    expect((await events()).filter((event) => event.kind === 'release_request_approved')).toHaveLength(1);

    await asOwner.post(`/v1/release-requests/${requestId}/close`);
    const closed = about(`@${owner.handle} closed`);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.text).toContain('open for work again');
  });
});

describe('member notices', () => {
  it('tells someone their new role, and that they were removed', async () => {
    const guest = await createUser(harness, 'guest');
    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: guest.handle, role: 'viewer' });
    expect(about(`added you to ${name}`).length).toBeGreaterThan(0);
    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: guest.handle, role: 'contributor' });
    expect(about(`You're now a contributor on ${name}`)).toHaveLength(1);
    // Saving the same role again isn't news.
    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: guest.handle, role: 'contributor' });
    expect(about(`You're now a contributor on ${name}`)).toHaveLength(1);

    // Their work keeps their name in the feed after they leave.
    const asGuest = client(harness, guest);
    expect((await asGuest.post(`/v1/projects/${projectId}/branches`, { name: 'guest-idea' })).status).toBe(201);
    await asOwner.delete(`/v1/projects/${projectId}/members/${guest.handle}`);
    expect(about(`removed you from ${name}`)).toHaveLength(1);
    const created = (await events()).find((event) => event.kind === 'branch_created' && event.payload.name === 'guest-idea');
    expect(created?.actorHandle).toBe(guest.handle);
  });
});

describe('the activity feed', () => {
  it('records only what changed in the project, as from and to', async () => {
    await asOwner.patch(`/v1/projects/${projectId}`, { name, description: 'Oak top', visibility: 'private' });
    const [latest] = await events('order=desc&limit=1');
    expect(latest!.kind).toBe('project_updated');
    expect(Object.keys(latest!.payload)).toEqual(['description']);
    expect(latest!.payload.description.to).toBe('Oak top');
    // Saving the same values again records nothing.
    await asOwner.patch(`/v1/projects/${projectId}`, { name, description: 'Oak top' });
    expect((await events('order=desc&limit=1'))[0]!.id).toBe(latest!.id);
  });

  it('pages back through older events', async () => {
    const newest = await events('order=desc&limit=3');
    const older = await events(`order=desc&limit=3&before=${newest.at(-1)!.id}`);
    expect(older.length).toBeGreaterThan(0);
    expect(Number(older[0]!.id)).toBeLessThan(Number(newest.at(-1)!.id));
  });

  it('skips a tag save that changes nothing', async () => {
    const tag = (await asOwner.post(`/v1/projects/${projectId}/tags`, { name: 'Printed' })).body;
    const branch = await asOwner.post(`/v1/projects/${projectId}/branches`, { name: 'tags' });
    const committed = await commitVersion(harness, asOwner, projectId, branch.body.id, { 'Leg.SLDPRT': `leg ${randomUUID()}` });
    const itemId = committed.files[0]!.itemId;
    await asOwner.put(`/v1/projects/${projectId}/items/${itemId}/tags`, { tagIds: [tag.id] });
    await asOwner.put(`/v1/projects/${projectId}/items/${itemId}/tags`, { tagIds: [tag.id] });
    expect((await events()).filter((event) => event.kind === 'file_tags_changed')).toHaveLength(1);
  });
});

describe('deleting a project', () => {
  it('tells its other members, not the person who deleted it', async () => {
    const before = about(`deleted ${name}`).length;
    expect((await asOwner.delete(`/v1/projects/${projectId}`)).status).toBe(204);
    expect(about(`deleted ${name}`)).toHaveLength(before + 2);
    expect(about(`deleted ${name}`)[0]!.text).toContain('restore it, with everything in it, for 30 days');
  });
});
