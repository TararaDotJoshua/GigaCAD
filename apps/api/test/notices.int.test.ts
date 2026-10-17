import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Mailer } from '../src/mail.js';
import { noticesSettled } from '../src/services/notices.js';
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
/** How many of the next sends fail, like a Resend 429. */
let failing = 0;
const about = (text: string) => sent.filter((message) => message.subject.includes(text));
/** Notices go out after the response; wait for them before looking. */
const mail = async (text: string) => {
  await noticesSettled();
  return about(text);
};

beforeAll(async () => {
  harness = await createHarness({
    mailer: {
      send: async (message) => {
        if (failing > 0 && failing--) throw new Error('Resend returned HTTP 429');
        sent.push(message);
      },
    },
  });
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

    const reviews = await mail(`Review #${opened.body.releaseRequest.number} Wider bench`);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.text).toContain('you can approve it');
    expect(reviews[0]!.text).toMatch(/\/release-requests\/\d+$/);

    // Rebuilding right away doesn't email again.
    await asContributor.post(`/v1/release-requests/${requestId}/candidate`);
    expect(await mail('Review #')).toHaveLength(1);
  });

  it('tells the requester when someone approves or closes it, and records one approval per candidate', async () => {
    const detail = (await asContributor.get(`/v1/release-requests/${requestId}`)).body;
    const body = { candidateManifestId: detail.candidate.manifestId };
    expect((await asMaintainer.post(`/v1/release-requests/${requestId}/approvals`, body)).status).toBe(200);
    expect((await asMaintainer.post(`/v1/release-requests/${requestId}/approvals`, body)).status).toBe(200);
    expect(await mail(`@${maintainer.handle} approved`)).toHaveLength(1);
    expect((await events()).filter((event) => event.kind === 'release_request_approved')).toHaveLength(1);

    await asOwner.post(`/v1/release-requests/${requestId}/close`);
    const closed = await mail(`@${owner.handle} closed`);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.text).toContain('open for work again');
  });
});

describe('member notices', () => {
  it('tells someone their new role, and that they were removed', async () => {
    const guest = await createUser(harness, 'guest');
    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: guest.handle, role: 'viewer' });
    expect((await mail(`added you to ${name}`)).length).toBeGreaterThan(0);
    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: guest.handle, role: 'contributor' });
    expect(await mail(`You're now a contributor on ${name}`)).toHaveLength(1);
    // Saving the same role again isn't news.
    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: guest.handle, role: 'contributor' });
    expect(await mail(`You're now a contributor on ${name}`)).toHaveLength(1);

    // Their work keeps their name in the feed after they leave.
    const asGuest = client(harness, guest);
    expect((await asGuest.post(`/v1/projects/${projectId}/branches`, { name: 'guest-idea' })).status).toBe(201);
    await asOwner.delete(`/v1/projects/${projectId}/members/${guest.handle}`);
    expect(await mail(`removed you from ${name}`)).toHaveLength(1);
    const created = (await events()).find((event) => event.kind === 'branch_created' && event.payload.name === 'guest-idea');
    expect(created?.actorHandle).toBe(guest.handle);
  });

  it('tells no one they were removed when they were never a member', async () => {
    const stranger = await createUser(harness, 'stranger');
    await asOwner.delete(`/v1/projects/${projectId}/members/${stranger.handle}`);
    expect(await mail(`removed you from ${name}`)).toHaveLength(1);
  });

  it('stops telling someone about their request once they leave a private project', async () => {
    const leaver = await createUser(harness, 'leaver');
    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: leaver.handle, role: 'contributor' });
    const asLeaver = client(harness, leaver);
    const branch = await asLeaver.post(`/v1/projects/${projectId}/branches`, { name: `leaving-${randomUUID().slice(0, 4)}` });
    await commitVersion(harness, asLeaver, projectId, branch.body.id, { 'Leaving.SLDPRT': `leaving ${randomUUID()}` });
    const opened = await asLeaver.post(`/v1/branches/${branch.body.id}/release-requests`, { title: 'Left behind' });
    await asOwner.delete(`/v1/projects/${projectId}/members/${leaver.handle}`);
    await asOwner.post(`/v1/release-requests/${opened.body.releaseRequest.id}/close`);
    // Only the earlier request's close email; nothing tells the leaver theirs was closed.
    expect(await mail('closed #')).toHaveLength(1);
    expect((await mail('Left behind')).filter((message) => message.subject.includes('closed'))).toHaveLength(0);
  });
});

describe('the activity feed', () => {
  it('records only what changed in the project, and an earlier value only for visibility', async () => {
    await asOwner.patch(`/v1/projects/${projectId}`, { name, description: 'Oak top', visibility: 'private' });
    const [latest] = await events('order=desc&limit=1');
    expect(latest!.kind).toBe('project_updated');
    expect(latest!.payload).toEqual({ description: { to: 'Oak top' } });
    await asOwner.patch(`/v1/projects/${projectId}`, { visibility: 'public' });
    expect((await events('order=desc&limit=1'))[0]!.payload).toEqual({ visibility: { from: 'private', to: 'public' } });
    await asOwner.patch(`/v1/projects/${projectId}`, { visibility: 'private' });
    // Saving the same values again records nothing.
    const [unchanged] = await events('order=desc&limit=1');
    await asOwner.patch(`/v1/projects/${projectId}`, { name, description: 'Oak top' });
    expect((await events('order=desc&limit=1'))[0]!.id).toBe(unchanged!.id);
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
  it('tells its other members, and one failed email doesn’t stop the rest', async () => {
    const before = (await mail(`deleted ${name}`)).length;
    failing = 1;
    expect((await asOwner.delete(`/v1/projects/${projectId}`)).status).toBe(204);
    // Two other members: one send failed, the other still went out.
    const deleted = await mail(`deleted ${name}`);
    expect(deleted).toHaveLength(before + 1);
    expect(deleted[0]!.text).toContain('restore it, with everything in it, for 30 days');
    expect(failing).toBe(0);
  });
});
