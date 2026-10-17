import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Mailer } from '../src/mail.js';
import { noticesSettled } from '../src/services/notices.js';
import { client, createHarness, createUser, type Client, type Harness, type TestUser } from './helpers.js';

let harness: Harness;
let owner: TestUser;
let teammate: TestUser;
let asOwner: Client;
let projectId: string;
const sent: Parameters<Mailer['send']>[0][] = [];

beforeAll(async () => {
  harness = await createHarness({ mailer: { send: async (message) => void sent.push(message) } });
  [owner, teammate] = await Promise.all([createUser(harness, 'owner'), createUser(harness, 'teammate')]);
  asOwner = client(harness, owner);
  const created = await asOwner.post('/v1/projects', { slug: `team-${randomUUID().slice(0, 8)}`, name: 'Team bench', visibility: 'private' });
  projectId = created.body.id;
});

afterAll(async () => {
  await harness?.close();
});

describe('finding people to add', () => {
  it('matches handles by their start, signed in only', async () => {
    const found = await asOwner.get(`/v1/profiles?q=${encodeURIComponent(`@${teammate.handle.slice(0, -2)}`)}`);
    expect(found.status).toBe(200);
    expect(found.body.map((profile: { handle: string }) => profile.handle)).toContain(teammate.handle);
    expect(Object.keys(found.body[0])).toEqual(expect.arrayContaining(['handle', 'displayName', 'avatarUrl']));
    expect((await client(harness, null).get('/v1/profiles?q=a')).status).toBe(401);
  });

  it('treats LIKE wildcards as plain text', async () => {
    expect((await asOwner.get('/v1/profiles?q=%25')).body).toEqual([]);
  });
});

describe('adding a member', () => {
  it('emails the person once, when they are first added', async () => {
    expect((await asOwner.put(`/v1/projects/${projectId}/members`, { handle: teammate.handle, role: 'viewer' })).status).toBe(200);
    const notices = sent.filter((message) => message.subject.includes('Team bench'));
    expect(notices).toHaveLength(1);
    expect(notices[0]!.subject).toBe(`@${owner.handle} added you to Team bench`);
    expect(notices[0]!.text).toContain('as a viewer');
    expect(notices[0]!.text).toContain(`http://localhost:3000/${owner.handle}/`);

    // A new role gets its own short notice, not a second welcome. It goes out after the response.
    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: teammate.handle, role: 'contributor' });
    await noticesSettled();
    expect(sent.filter((message) => message.subject.includes('added you to Team bench'))).toHaveLength(1);
    expect(sent.filter((message) => message.subject === "You're now a contributor on Team bench")).toHaveLength(1);
  });
});

describe('managing members', () => {
  async function team() {
    const created = await asOwner.post('/v1/projects', { slug: `crew-${randomUUID().slice(0, 8)}`, name: 'Crew', visibility: 'private' });
    const id = created.body.id as string;
    const [maintainer, viewer] = await Promise.all([createUser(harness, 'lead'), createUser(harness, 'watcher')]);
    expect((await asOwner.post(`/v1/projects/${id}/members`, { handle: maintainer.handle, role: 'maintainer' })).status).toBe(201);
    expect((await asOwner.post(`/v1/projects/${id}/members`, { handle: viewer.handle, role: 'viewer' })).status).toBe(201);
    return { id, maintainer, viewer };
  }
  const roleOf = async (id: string, handle: string) =>
    ((await asOwner.get(`/v1/projects/${id}/members`)).body as { handle: string; role: string }[]).find((member) => member.handle === handle)?.role;
  const eventCount = async (id: string, kind: string) =>
    ((await asOwner.get(`/v1/projects/${id}/events?limit=500`)).body as { kind: string }[]).filter((event) => event.kind === kind).length;

  it('never changes an existing member’s role when adding', async () => {
    const { id, maintainer } = await team();
    const again = await asOwner.post(`/v1/projects/${id}/members`, { handle: maintainer.handle, role: 'viewer' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'already_member', details: { role: 'maintainer' } });
    expect(await roleOf(id, maintainer.handle)).toBe('maintainer');
  });

  it('records nothing for a change that changes nothing, and 404s for someone who isn’t a member', async () => {
    const { id, viewer } = await team();
    const before = await eventCount(id, 'member_changed');
    expect((await asOwner.put(`/v1/projects/${id}/members`, { handle: viewer.handle, role: 'viewer' })).status).toBe(200);
    expect((await asOwner.delete(`/v1/projects/${id}/members/${teammate.handle}`)).status).toBe(404);
    expect(await eventCount(id, 'member_changed')).toBe(before);

    const updates = await eventCount(id, 'project_updated');
    expect((await asOwner.patch(`/v1/projects/${id}`, { name: 'Crew' })).status).toBe(200);
    expect(await eventCount(id, 'project_updated')).toBe(updates);
  });

  it('lets anyone but the owner leave', async () => {
    const { id, maintainer, viewer } = await team();
    const left = await client(harness, viewer).delete(`/v1/projects/${id}/members/${viewer.handle}`);
    expect(left.status).toBe(204);
    expect(await roleOf(id, viewer.handle)).toBeUndefined();
    expect((await client(harness, viewer).get(`/v1/projects/${id}`)).status).toBe(404);
    // A maintainer leaving isn't the owner removing a maintainer.
    expect((await client(harness, maintainer).delete(`/v1/projects/${id}/members/${maintainer.handle}`)).status).toBe(204);
    expect((await asOwner.delete(`/v1/projects/${id}/members/${owner.handle}`)).status).toBe(400);
    const events = (await asOwner.get(`/v1/projects/${id}/events?order=desc&limit=5`)).body as { kind: string; payload: Record<string, unknown> }[];
    expect(events.find((event) => event.kind === 'member_changed')?.payload).toMatchObject({ handle: maintainer.handle, role: null, left: true });
  });

  it('drops a removed member from the named approvers', async () => {
    const { id, viewer } = await team();
    const rules = { requiredCount: 1, approverUserIds: [viewer.id], approverRoles: ['owner'], allowSelfApproval: false, requireCleanRebuild: false };
    expect((await asOwner.put(`/v1/projects/${id}/approval-rules`, rules)).status).toBe(200);
    await asOwner.delete(`/v1/projects/${id}/members/${viewer.handle}`);
    await asOwner.post(`/v1/projects/${id}/members`, { handle: viewer.handle, role: 'viewer' });
    expect((await asOwner.get(`/v1/projects/${id}/approval-rules`)).body.approverUserIds).toEqual([]);
  });

  it('keeps visibility and approval rules with the owner', async () => {
    const { id, maintainer } = await team();
    const asMaintainer = client(harness, maintainer);
    expect((await asMaintainer.patch(`/v1/projects/${id}`, { visibility: 'public' })).status).toBe(403);
    // Saving the form with visibility unchanged is fine.
    expect((await asMaintainer.patch(`/v1/projects/${id}`, { name: 'Crew bench', visibility: 'private' })).status).toBe(200);
    const rules = { requiredCount: 0, approverUserIds: [], approverRoles: ['maintainer'], allowSelfApproval: true, requireCleanRebuild: false };
    expect((await asMaintainer.put(`/v1/projects/${id}/approval-rules`, rules)).status).toBe(403);
  });
});
