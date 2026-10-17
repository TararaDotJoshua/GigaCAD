import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeDeviceCodes } from '../src/jobs.js';
import { HIDDEN_LOCK_HOLDER, HIDDEN_LOCK_MACHINE } from '../src/services/access.js';
import { resolveFiles } from '../src/services/manifests.js';
import {
  call,
  client,
  commitVersion,
  createHarness,
  createSignedInUser,
  createUser,
  MACHINE,
  supabaseAdmin,
  upload,
  type Client,
  type Harness,
  type TestUser,
} from './helpers.js';

let harness: Harness;
let owner: TestUser;
let teammate: TestUser;
let asOwner: Client;
let asTeammate: Client;
const anonymous = () => client(harness, null);

beforeAll(async () => {
  harness = await createHarness();
  [owner, teammate] = await Promise.all([createUser(harness, 'keeper'), createUser(harness, 'mate')]);
  asOwner = client(harness, owner);
  asTeammate = client(harness, teammate);
});

afterAll(async () => {
  await harness?.close();
});

async function project(visibility: 'public' | 'private' = 'private') {
  const created = await asOwner.post('/v1/projects', { slug: `sec-${randomUUID().slice(0, 8)}`, name: 'Security bench', visibility });
  expect(created.status).toBe(201);
  const projectId = created.body.id as string;
  const branch = await asOwner.post(`/v1/projects/${projectId}/branches`, { name: 'work' });
  return { projectId, branchId: branch.body.id as string };
}

async function release(api: Client, branchId: string) {
  const opened = await api.post(`/v1/branches/${branchId}/release-requests`, { title: 'v1' });
  const requestId = opened.body.releaseRequest.id as string;
  const candidateManifestId = (await api.post(`/v1/release-requests/${requestId}/candidate`)).body.candidate.manifestId;
  await api.post(`/v1/release-requests/${requestId}/approvals`, { candidateManifestId });
  expect((await api.post(`/v1/release-requests/${requestId}/release`, { candidateManifestId })).status).toBe(201);
}

/** A device token for a user, through the real device sign-in. */
async function deviceToken(user: TestUser, clientName = 'giga CLI on test-laptop') {
  const started = await anonymous().post('/v1/auth/device/code', { clientName });
  await client(harness, user).post('/v1/auth/device/approve', { userCode: started.body.userCode });
  const granted = await anonymous().post('/v1/auth/device/token', { deviceCode: started.body.deviceCode });
  return granted.body as { accessToken: string; tokenId: string };
}

describe('branch commits', () => {
  it('refuse paths a Windows teammate can’t sync or that read as something else', async () => {
    const { projectId, branchId } = await project();
    const checkout = await asOwner.post(`/v1/branches/${branchId}/checkout`, { machine: MACHINE });
    const [blob] = (await upload(harness, asOwner, projectId, [`content ${randomUUID()}`])) as [string];
    for (const path of ['parts/stream.txt:hidden.exe', 'parts/CON.SLDPRT', 'parts/trailing. ', 'a<b>|c?.SLDPRT', 'parts/‮txt.exe', 'a\u0000b.txt']) {
      const commit = await asOwner.post(`/v1/branches/${branchId}/commits`, {
        parentId: checkout.body.headCommitId,
        machine: MACHINE,
        kind: 'version',
        message: 'test',
        files: [{ path, blob }],
      });
      expect(commit.status, path).toBe(422);
      expect(commit.body.error.code, path).toBe('invalid_path');
    }
  });

  it('keep working with names stored before the rule, while new names must be Windows-safe', async () => {
    const { projectId, branchId } = await project();
    const committed = await commitVersion(harness, asOwner, projectId, branchId, { 'parts/a.txt': `a ${randomUUID()}` });
    const { itemId, blob } = committed.files[0]!;
    // A branch an older CLI committed "parts/Aux.SLDPRT" to.
    const previous = [{ itemId, path: 'parts/Aux.SLDPRT', blob }];
    await expect(resolveFiles(harness.sql, projectId, [{ path: 'parts/Aux.SLDPRT', blob, itemId }], previous)).resolves.toHaveLength(1);
    await expect(resolveFiles(harness.sql, projectId, [{ path: 'parts/aux.sldprt', blob, itemId }], previous)).resolves.toHaveLength(1);
    await expect(resolveFiles(harness.sql, projectId, [{ path: 'parts/Con.SLDPRT', blob, itemId }], previous)).rejects.toMatchObject({ code: 'invalid_path' });
  });

  it('can’t claim a root file’s item, so the root file can still be deleted', async () => {
    const { projectId, branchId } = await project();
    const [blob] = (await upload(harness, asOwner, projectId, [`root ${randomUUID()}`])) as [string];
    const root = await asOwner.post(`/v1/projects/${projectId}/directory/files`, { parentId: null, name: 'Root.SLDPRT', blob });
    expect(root.status).toBe(201);
    const [entry] = await harness.sql<{ id: string; itemId: string }[]>`
      select id, item_id from directory_entries where project_id = ${projectId} and name = 'Root.SLDPRT'
    `;
    const { id: entryId, itemId } = entry!;
    await expect(commitVersion(harness, asOwner, projectId, branchId, { 'Unrelated.SLDPRT': `x ${randomUUID()}` }, { itemIds: { 'Unrelated.SLDPRT': itemId } })).rejects.toThrow(/unknown_items/);
    expect((await asOwner.delete(`/v1/projects/${projectId}/directory/entries/${entryId}`)).status).toBe(204);
  });
});

describe('text Postgres can’t store', () => {
  it('is a 400, not a 500', async () => {
    const { projectId } = await project();
    expect((await asOwner.post(`/v1/projects/${projectId}/tags`, { name: 'a\u0000' })).status).toBe(400);
    expect((await anonymous().get('/v1/users/%00')).status).toBe(400);
    expect((await anonymous().get('/v1/explore?q=%00')).status).toBe(400);
  });
});

describe('device tokens', () => {
  it('can’t rename the account or sign out other devices, only themselves', async () => {
    const user = await createUser(harness, 'gadget');
    const [first, second] = [await deviceToken(user), await deviceToken(user)];
    const asDevice = (token: string) => ({
      patch: (url: string, body: unknown) => call(harness, token, 'PATCH', url, body),
      delete: (url: string) => call(harness, token, 'DELETE', url),
    });
    expect((await asDevice(first.accessToken).patch('/v1/me', { bio: 'hijacked' })).status).toBe(403);
    expect((await asDevice(first.accessToken).delete(`/v1/me/tokens/${second.tokenId}`)).status).toBe(403);
    expect((await asDevice(first.accessToken).delete(`/v1/me/tokens/${first.tokenId}`)).status).toBe(204);
    // The website can still sign out any device.
    expect((await client(harness, user).delete(`/v1/me/tokens/${second.tokenId}`)).status).toBe(204);
  });

  it('limit how fast sign-ins can be started, and old codes are purged', async () => {
    const isolated = await createHarness();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) statuses.push((await isolated.app.inject({ method: 'POST', url: '/v1/auth/device/code', payload: { clientName: 'spam' } })).statusCode);
      expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
      const limited = await isolated.app.inject({ method: 'POST', url: '/v1/auth/device/code', payload: { clientName: 'spam' } });
      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await isolated.close();
    }
    const code = `OLD${randomUUID().slice(0, 5).toUpperCase()}`;
    await harness.sql`
      insert into device_codes (device_code_hash, user_code, client_name, expires_at)
      values (${randomUUID()}, ${code}, 'old', now() - interval '2 days')
    `;
    expect(await purgeDeviceCodes(harness.sql)).toBeGreaterThan(0);
    expect(await harness.sql`select 1 from device_codes where user_code = ${code}`).toHaveLength(0);
  });
});

describe('sessions', () => {
  it('stop working on the API once they are signed out', async () => {
    const user = await createSignedInUser('leaver');
    expect((await call(harness, user.token, 'GET', '/v1/me')).status).toBe(200);
    // A fresh authenticator has no cached check, like an API instance after the session ends.
    const { error } = await supabaseAdmin().auth.admin.signOut(user.token, 'global');
    expect(error).toBeNull();
    const fresh = await createHarness();
    try {
      expect((await call(fresh, user.token, 'GET', '/v1/me')).status).toBe(401);
    } finally {
      await fresh.close();
    }
  });
});

describe('handles', () => {
  it('without a chosen one, can’t own a project or a public profile', async () => {
    const user = await createSignedInUser('fresh');
    const [profile] = await harness.sql<{ handle: string }[]>`select handle from profiles where id = ${user.id}`;
    const handle = profile!.handle;
    const created = await call(harness, user.token, 'POST', '/v1/projects', { slug: 'bench', name: 'Bench' });
    expect(created.status).toBe(422);
    expect(created.body.error.code).toBe('handle_required');
    expect((await anonymous().get(`/v1/users/${handle}`)).status).toBe(404);
    expect((await asOwner.get(`/v1/users/${handle}`)).status).toBe(404);
    expect((await call(harness, user.token, 'GET', `/v1/users/${handle}`)).status).toBe(200);
  });

  it('given up are held for others, but the old account can take theirs back', async () => {
    const first = await createUser(harness, 'renamer');
    const old = first.handle;
    expect((await client(harness, first).patch('/v1/me', { handle: `${old}-new` })).status).toBe(200);
    const taken = await asTeammate.patch('/v1/me', { handle: old });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('handle_unavailable');
    expect((await client(harness, first).patch('/v1/me', { handle: old })).status).toBe(200);
  });
});

describe('public projects', () => {
  it('show who holds a lock to outsiders, but not on which machine', async () => {
    const { projectId, branchId } = await project('public');
    await asOwner.post(`/v1/branches/${branchId}/checkout`, { machine: 'JOSHS-MACBOOK' });
    // Installed CLIs read a null holder as "not checked out", so outsiders get stand-ins, not nulls.
    const hidden = { checkedOutByHandle: owner.handle, checkedOutBy: HIDDEN_LOCK_HOLDER, checkedOutMachine: HIDDEN_LOCK_MACHINE };
    for (const viewer of [anonymous(), client(harness, await createUser(harness, 'onlooker'))]) {
      const listed = (await viewer.get(`/v1/projects/${projectId}/branches`)).body.find((branch: { id: string }) => branch.id === branchId);
      expect(listed).toMatchObject(hidden);
      expect((await viewer.get(`/v1/branches/${branchId}`)).body.branch).toMatchObject(hidden);
      const folders = (await viewer.get(`/v1/projects/${projectId}/directory?path=Branches`)).body.entries as { name: string; branch: object }[];
      expect(folders.find((folder) => folder.name === 'work')?.branch).toMatchObject(hidden);
      expect((await viewer.get(`/v1/projects/${projectId}/directory?path=Branches/work`)).body.location.branch).toMatchObject(hidden);
      expect(JSON.stringify((await viewer.get(`/v1/projects/${projectId}/directory?path=Branches`)).body)).not.toContain('JOSHS-MACBOOK');
    }
    expect((await asOwner.get(`/v1/branches/${branchId}`)).body.branch).toMatchObject({ checkedOutBy: owner.id, checkedOutMachine: 'JOSHS-MACBOOK' });
    expect((await asOwner.get(`/v1/projects/${projectId}/directory?path=Branches/work`)).body.location.branch.checkedOutMachine).toBe('JOSHS-MACBOOK');
    // The activity feed doesn't give the computer away either.
    expect(JSON.stringify((await anonymous().get(`/v1/projects/${projectId}/events`)).body)).not.toContain('JOSHS-MACBOOK');
    expect(JSON.stringify((await asOwner.get(`/v1/projects/${projectId}/events`)).body)).toContain('JOSHS-MACBOOK');
    // A branch nobody holds stays plainly unlocked.
    await asOwner.post(`/v1/branches/${branchId}/checkin`);
    expect((await anonymous().get(`/v1/branches/${branchId}`)).body.branch).toMatchObject({ checkedOutBy: null, checkedOutMachine: null });
  });

  it('list members to outsiders by handle only, without ids, roles, or named approvers', async () => {
    const { projectId } = await project('public');
    await asOwner.post(`/v1/projects/${projectId}/members`, { handle: teammate.handle, role: 'maintainer' });
    const rules = { requiredCount: 1, approverUserIds: [teammate.id], approverRoles: ['owner'], allowSelfApproval: false, requireCleanRebuild: false };
    expect((await asOwner.put(`/v1/projects/${projectId}/approval-rules`, rules)).status).toBe(200);

    for (const outsider of [anonymous(), client(harness, await createUser(harness, 'passerby'))]) {
      const members = (await outsider.get(`/v1/projects/${projectId}/members`)).body as Record<string, unknown>[];
      expect(members.map((member) => member.handle)).toEqual([owner.handle, teammate.handle]);
      for (const member of members) expect(Object.keys(member).sort()).toEqual(['avatarUrl', 'displayName', 'handle']);
      expect((await outsider.get(`/v1/projects/${projectId}/approval-rules`)).body).toMatchObject({ requiredCount: 1, approverUserIds: [], approverRoles: ['owner'] });
    }
    const inside = (await asTeammate.get(`/v1/projects/${projectId}/members`)).body as { userId: string; role: string }[];
    expect(inside.map((member) => member.role)).toEqual(['owner', 'maintainer']);
    expect((await asTeammate.get(`/v1/projects/${projectId}/approval-rules`)).body.approverUserIds).toEqual([teammate.id]);
  });

  it('hide the same things from the Data API and Realtime as from the API', async () => {
    const { projectId, branchId } = await project('public');
    await asOwner.post(`/v1/projects/${projectId}/members`, { handle: teammate.handle, role: 'viewer' });
    await asOwner.post(`/v1/branches/${branchId}/checkout`, { machine: 'JOSHS-MACBOOK' });
    // Reads as the Data API runs them: the anon role, or a signed-in user's claims.
    const as = <T>(role: 'anon' | 'authenticated', userId: string | null, read: (tx: typeof harness.sql) => Promise<T>) =>
      harness.sql
        .begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify(userId ? { sub: userId, role } : { role })}, true)`;
          await tx.unsafe(`set local role ${role}`);
          return { ok: await read(tx as unknown as typeof harness.sql) };
        })
        .catch((error: { code?: string }) => ({ ok: undefined, code: error.code }));
    const outsider = await createUser(harness, 'reader');
    for (const [role, userId] of [['anon', null], ['authenticated', outsider.id]] as const) {
      expect((await as(role, userId, (tx) => tx`select user_id from project_members where project_id = ${projectId}`)).ok).toHaveLength(0);
      expect((await as(role, userId, (tx) => tx`select approver_user_ids from approval_rules where project_id = ${projectId}`)).ok).toHaveLength(0);
      const kinds = (await as(role, userId, (tx) => tx<{ kind: string }[]>`select kind from project_events where project_id = ${projectId}`)).ok!.map((row) => row.kind);
      expect(kinds).toContain('project_created');
      expect(kinds).not.toContain('member_changed');
      expect(kinds).not.toContain('branch_checked_out');
      expect((await as(role, userId, (tx) => tx`select name from branches where id = ${branchId}`)).ok).toHaveLength(1);
      expect(await as(role, userId, (tx) => tx`select checked_out_machine from branches where id = ${branchId}`)).toMatchObject({ code: '42501' });
      expect(await as(role, userId, (tx) => tx`select rebuild_report from release_requests where project_id = ${projectId}`)).toMatchObject({ code: '42501' });
    }
    // Members still read their project's members and events.
    expect((await as('authenticated', teammate.id, (tx) => tx`select user_id from project_members where project_id = ${projectId}`)).ok).toHaveLength(2);
    const memberKinds = (await as('authenticated', teammate.id, (tx) => tx<{ kind: string }[]>`select kind from project_events where project_id = ${projectId}`)).ok!.map((row) => row.kind);
    expect(memberKinds).toEqual(expect.arrayContaining(['member_changed', 'branch_checked_out']));
  });

  it('keep membership changes out of the outsiders’ feed, and name each actor', async () => {
    const { projectId } = await project('public');
    await asOwner.post(`/v1/projects/${projectId}/members`, { handle: teammate.handle, role: 'viewer' });
    const outside = (await anonymous().get(`/v1/projects/${projectId}/events`)).body as { kind: string; actorHandle: string }[];
    expect(outside.some((event) => event.kind === 'member_changed')).toBe(false);
    expect(outside.find((event) => event.kind === 'project_created')?.actorHandle).toBe(owner.handle);
    const inside = (await asOwner.get(`/v1/projects/${projectId}/events`)).body as { kind: string }[];
    expect(inside.some((event) => event.kind === 'member_changed')).toBe(true);
  });
});

describe('forking a private project', () => {
  it('is for maintainers, and the source hears about it', async () => {
    const { projectId, branchId } = await project('private');
    await commitVersion(harness, asOwner, projectId, branchId, { 'Part.SLDPRT': `part ${randomUUID()}` });
    await release(asOwner, branchId);
    await asOwner.post(`/v1/projects/${projectId}/members`, { handle: teammate.handle, role: 'viewer' });
    const fork = (as: Client) => as.post(`/v1/projects/${projectId}/forks`, { slug: `fork-${randomUUID().slice(0, 8)}`, name: 'Fork' });
    expect((await fork(asTeammate)).status).toBe(403);

    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: teammate.handle, role: 'maintainer' });
    const made = await fork(asTeammate);
    expect(made.status).toBe(201);
    const events = (await asOwner.get(`/v1/projects/${projectId}/events?order=desc&limit=5`)).body as { kind: string; payload: Record<string, unknown> }[];
    expect(events.find((event) => event.kind === 'project_forked')?.payload).toMatchObject({ releaseNumber: 1, fork: { ownerHandle: teammate.handle } });
    const forkEvents = (await asTeammate.get(`/v1/projects/${made.body.id}/events`)).body as { kind: string; payload: Record<string, unknown> }[];
    expect(forkEvents.find((event) => event.kind === 'project_created')?.payload.forkedFrom).toMatchObject({ ownerHandle: owner.handle, releaseNumber: 1 });
  });
});

describe('rebuild reports', () => {
  it('record who sent them, when, and from where', async () => {
    const { projectId, branchId } = await project();
    await commitVersion(harness, asOwner, projectId, branchId, { 'Part.SLDPRT': `part ${randomUUID()}` });
    const opened = await asOwner.post(`/v1/branches/${branchId}/release-requests`, { title: 'Report' });
    const requestId = opened.body.releaseRequest.id as string;
    const candidate = await asOwner.post(`/v1/release-requests/${requestId}/candidate`);
    const device = await deviceToken(owner, 'GigaCAD add-in on SW-PC');
    const reported = await call(harness, device.accessToken, 'POST', `/v1/release-requests/${requestId}/rebuild-report`, {
      candidateManifestId: candidate.body.releaseRequest.candidateManifestId,
      status: 'passed',
      messages: [],
    });
    expect(reported.status).toBe(200);
    expect(reported.body.releaseRequest.rebuildReport).toMatchObject({
      reportedBy: { userId: owner.id, handle: owner.handle },
      reportedAt: expect.any(String),
      via: 'device',
      deviceName: 'GigaCAD add-in on SW-PC',
    });
    // Outsiders of a public project learn it came from a desktop sign-in, not which computer.
    await asOwner.patch(`/v1/projects/${projectId}`, { visibility: 'public' });
    const outside = (await anonymous().get(`/v1/release-requests/${requestId}`)).body.releaseRequest.rebuildReport;
    expect(outside).toMatchObject({ via: 'device', reportedBy: { handle: owner.handle } });
    expect(outside.deviceName).toBeUndefined();
  });
});
