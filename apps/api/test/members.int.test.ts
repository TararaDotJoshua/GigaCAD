import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Mailer } from '../src/mail.js';
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

    // Changing the role isn't news.
    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: teammate.handle, role: 'contributor' });
    expect(sent.filter((message) => message.subject.includes('Team bench'))).toHaveLength(1);
  });
});
