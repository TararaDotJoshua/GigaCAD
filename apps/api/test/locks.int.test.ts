import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Mailer } from '../src/mail.js';
import { noticesSettled } from '../src/services/notices.js';
import { client, createHarness, createUser, MACHINE, upload, type Client, type Harness, type TestUser } from './helpers.js';

// A lock is someone's promise that nobody else will change a branch. These cover every way
// one ends besides its holder checking in: each is logged with the holder's name and they're told.

let harness: Harness;
let owner: TestUser;
let maker: TestUser;
let helper: TestUser;
let asOwner: Client;
let asMaker: Client;
let asHelper: Client;
const sent: Parameters<Mailer['send']>[0][] = [];

beforeAll(async () => {
  harness = await createHarness({ mailer: { send: async (message) => void sent.push(message) } });
  [owner, maker, helper] = await Promise.all([createUser(harness, 'owner'), createUser(harness, 'maker'), createUser(harness, 'helper')]);
  asOwner = client(harness, owner);
  asMaker = client(harness, maker);
  asHelper = client(harness, helper);
});

afterAll(async () => {
  await harness?.close();
});

async function newProject() {
  const response = await asOwner.post('/v1/projects', { slug: `locks-${randomUUID().slice(0, 8)}`, name: `Locks ${randomUUID().slice(0, 4)}` });
  expect(response.status).toBe(201);
  const projectId = response.body.id as string;
  await asOwner.put(`/v1/projects/${projectId}/members`, { handle: maker.handle, role: 'contributor' });
  await asOwner.put(`/v1/projects/${projectId}/members`, { handle: helper.handle, role: 'contributor' });
  return { projectId, name: response.body.name as string };
}

async function newBranch(projectId: string, name = `work-${randomUUID().slice(0, 6)}`) {
  const response = await asOwner.post(`/v1/projects/${projectId}/branches`, { name });
  expect(response.status).toBe(201);
  return { id: response.body.id as string, name };
}

/** The maker checks out and leaves an autosave, as the drive does while they work. */
async function holdWithAutosave(projectId: string, branchId: string) {
  const checkout = await asMaker.post(`/v1/branches/${branchId}/checkout`, { machine: MACHINE });
  expect(checkout.status).toBe(200);
  const [blob] = await upload(harness, asMaker, projectId, [`autosave ${randomUUID()}`]);
  const autosave = await asMaker.post(`/v1/branches/${branchId}/commits`, {
    parentId: checkout.body.headCommitId,
    machine: MACHINE,
    kind: 'autosave',
    files: [{ path: 'Part.SLDPRT', blob }],
  });
  expect(autosave.status).toBe(201);
  return autosave.body.commit.id as string;
}

const lockEvents = async (projectId: string, branchId: string) =>
  ((await asOwner.get(`/v1/projects/${projectId}/events`)).body as { kind: string; subjectId: string }[]).filter(
    (event) => event.kind === 'branch_lock_force_released' && event.subjectId === branchId,
  );
/** Notices go out after the response, so wait for them first. */
const noticesAbout = async (branchName: string) => {
  await noticesSettled();
  return sent.filter((message) => message.subject.includes(branchName));
};

describe('archiving a branch', () => {
  it('releases the lock, logs and tells the holder, and keeps their autosaves', async () => {
    const { projectId, name } = await newProject();
    const branch = await newBranch(projectId);
    const autosaveId = await holdWithAutosave(projectId, branch.id);

    const archived = await asOwner.post(`/v1/branches/${branch.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ status: 'archived', checkedOutBy: null, archivedByHandle: owner.handle, headCommitId: autosaveId });
    expect(archived.body.archivedAt).toBeTruthy();

    expect(await lockEvents(projectId, branch.id)).toMatchObject([
      { actorId: owner.id, payload: { previousHolder: maker.id, machine: MACHINE, reason: 'archived' } },
    ]);
    const [notice, ...others] = await noticesAbout(branch.name);
    expect(others).toHaveLength(0);
    expect(notice!.subject).toBe(`Your checkout of ${branch.name} in ${name} was released`);
    expect(notice!.text).toContain(`@${owner.handle} archived ${branch.name} in ${name}`);
    expect(notice!.text).toContain('1 autosave');
    expect(notice!.to).toMatch(/^maker-/);

    // Nothing more happens the second time.
    expect((await asOwner.post(`/v1/branches/${branch.id}/archive`)).status).toBe(200);
    const archives = (await asOwner.get(`/v1/projects/${projectId}/events`)).body.filter((event: { kind: string }) => event.kind === 'branch_archived');
    expect(archives).toHaveLength(1);
    expect(await noticesAbout(branch.name)).toHaveLength(1);
  });

  it("doesn't tell outsiders who held the lock or why it was released", async () => {
    const created = await asOwner.post('/v1/projects', { slug: `open-${randomUUID().slice(0, 8)}`, name: 'Open bench', visibility: 'public' });
    const projectId = created.body.id as string;
    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: maker.handle, role: 'contributor' });
    const branch = await newBranch(projectId);
    await holdWithAutosave(projectId, branch.id);
    await asOwner.post(`/v1/branches/${branch.id}/archive`);

    const seen = (await client(harness, null).get(`/v1/projects/${projectId}/events`)).body as { kind: string; payload: Record<string, unknown> }[];
    const released = seen.find((event) => event.kind === 'branch_lock_force_released')!;
    expect(released.payload).not.toHaveProperty('reason');
    expect(released.payload).not.toHaveProperty('previousHolder');
    expect(released.payload).not.toHaveProperty('machine');
    const archive = seen.find((event) => event.kind === 'branch_archived')!;
    expect(archive.payload).toEqual({ name: branch.name });
    const archived = (await client(harness, null).get(`/v1/branches/${branch.id}`)).body.branch;
    expect(archived).toMatchObject({ status: 'archived', archivedByHandle: null });

    // The anon key reads events through the Data API too: the lock release stays hidden there,
    // and the archive event names no one.
    const rows = await harness.sql.begin(async (tx) => {
      await tx`set local role anon`;
      return tx<{ kind: string; payload: Record<string, unknown> }[]>`select kind, payload from project_events where project_id = ${projectId}`;
    });
    expect(rows.map((row) => row.kind)).not.toContain('branch_lock_force_released');
    for (const row of rows) expect(JSON.stringify(row.payload)).not.toContain(maker.id);
  });

  it('sends no notice when nobody held it, and refuses released branches', async () => {
    const { projectId } = await newProject();
    const free = await newBranch(projectId);
    expect((await asOwner.post(`/v1/branches/${free.id}/archive`)).status).toBe(200);
    expect(await lockEvents(projectId, free.id)).toHaveLength(0);
    expect(await noticesAbout(free.name)).toHaveLength(0);

    const shipped = await newBranch(projectId);
    await harness.sql`update branches set status = 'released' where id = ${shipped.id}`;
    const refused = await asOwner.post(`/v1/branches/${shipped.id}/archive`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('branch_not_open');
    expect((await asOwner.get(`/v1/branches/${shipped.id}`)).body.branch.status).toBe('released');
  });

  it('can be undone by a maintainer, with the history and autosaves back', async () => {
    const { projectId } = await newProject();
    const branch = await newBranch(projectId);
    const autosaveId = await holdWithAutosave(projectId, branch.id);
    await asOwner.post(`/v1/branches/${branch.id}/archive`);

    expect((await asMaker.post(`/v1/branches/${branch.id}/unarchive`)).status).toBe(403);
    const restored = await asOwner.post(`/v1/branches/${branch.id}/unarchive`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ status: 'open', headCommitId: autosaveId, archivedByHandle: null, archivedAt: null });
    const events = (await asOwner.get(`/v1/projects/${projectId}/events`)).body as { kind: string }[];
    expect(events.map((event) => event.kind)).toContain('branch_unarchived');

    // The holder picks up where they left off.
    const again = await asMaker.post(`/v1/branches/${branch.id}/checkout`, { machine: MACHINE });
    expect(again.status).toBe(200);
    expect(again.body.headCommitId).toBe(autosaveId);

    // Only archived branches can be restored.
    expect((await asOwner.post(`/v1/branches/${branch.id}/unarchive`)).status).toBe(200);
    await harness.sql`update branches set status = 'released', checked_out_by = null, checked_out_machine = null, checked_out_at = null where id = ${branch.id}`;
    expect((await asOwner.post(`/v1/branches/${branch.id}/unarchive`)).body.error.code).toBe('branch_not_archived');
  });

  it("says when a new branch's name belongs to an archived one", async () => {
    const { projectId } = await newProject();
    const branch = await newBranch(projectId, `Gripper-${randomUUID().slice(0, 4)}`);
    await asOwner.post(`/v1/branches/${branch.id}/archive`);
    const clash = await asOwner.post(`/v1/projects/${projectId}/branches`, { name: branch.name.toLowerCase() });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatchObject({ code: 'branch_exists_archived', details: { name: branch.name } });
  });
});

describe('removing a member', () => {
  it('releases their locks in the same change, logs each one, and tells them', async () => {
    const { projectId, name } = await newProject();
    const first = await newBranch(projectId);
    const second = await newBranch(projectId);
    await holdWithAutosave(projectId, first.id);
    expect((await asMaker.post(`/v1/branches/${second.id}/checkout`, { machine: 'maker-pc' })).status).toBe(200);
    const other = await newBranch(projectId);
    expect((await asHelper.post(`/v1/branches/${other.id}/checkout`, { machine: 'helper-pc' })).status).toBe(200);

    expect((await asOwner.delete(`/v1/projects/${projectId}/members/${maker.handle}`)).status).toBe(200);

    for (const branch of [first, second]) {
      expect((await asOwner.get(`/v1/branches/${branch.id}`)).body.branch.checkedOutBy).toBeNull();
      expect(await lockEvents(projectId, branch.id)).toMatchObject([{ actorId: owner.id, payload: { previousHolder: maker.id, reason: 'member_removed' } }]);
      const [notice] = await noticesAbout(branch.name);
      expect(notice!.text).toContain(`@${owner.handle} changed your access to ${name}`);
      // They can't open the project any more, so there's no link.
      expect(notice!.text).not.toContain('http');
    }
    // Someone else's lock is untouched, and the freed branches can be checked out.
    expect((await asOwner.get(`/v1/branches/${other.id}`)).body.branch.checkedOutBy).toBe(helper.id);
    expect((await asHelper.post(`/v1/branches/${first.id}/checkin`)).status).toBe(200);
    expect((await asOwner.post(`/v1/branches/${first.id}/checkout`, { machine: 'owner-pc' })).status).toBe(200);
  });

  it('releases locks when someone is made a viewer, but not for other role changes', async () => {
    const { projectId } = await newProject();
    const branch = await newBranch(projectId);
    await asMaker.post(`/v1/branches/${branch.id}/checkout`, { machine: MACHINE });

    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: maker.handle, role: 'maintainer' });
    expect((await asOwner.get(`/v1/branches/${branch.id}`)).body.branch.checkedOutBy).toBe(maker.id);

    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: maker.handle, role: 'viewer' });
    expect((await asOwner.get(`/v1/branches/${branch.id}`)).body.branch.checkedOutBy).toBeNull();
    expect(await lockEvents(projectId, branch.id)).toHaveLength(1);
  });
});

describe('force-releasing a lock', () => {
  it('tells the holder, with a link back to the branch', async () => {
    const { projectId } = await newProject();
    const branch = await newBranch(projectId);
    await holdWithAutosave(projectId, branch.id);
    expect((await asOwner.post(`/v1/branches/${branch.id}/force-release`)).status).toBe(200);
    const [notice, ...others] = await noticesAbout(branch.name);
    expect(others).toHaveLength(0);
    expect(notice!.text).toContain(`@${owner.handle} force-released your checkout of ${branch.name}`);
    expect(notice!.text).toContain(`/branches/${branch.name}`);
  });

  it('sends nothing when a maintainer takes back their own lock', async () => {
    const { projectId } = await newProject();
    const branch = await newBranch(projectId);
    await asOwner.post(`/v1/branches/${branch.id}/checkout`, { machine: MACHINE });
    expect((await asOwner.post(`/v1/branches/${branch.id}/force-release`)).status).toBe(200);
    expect(await noticesAbout(branch.name)).toHaveLength(0);
    expect(await lockEvents(projectId, branch.id)).toHaveLength(1);
  });
});

describe('branch names', () => {
  it('get one precise message per problem', async () => {
    const { projectId } = await newProject();
    const refused = async (name: string) => (await asOwner.post(`/v1/projects/${projectId}/branches`, { name })).body.error;
    expect(await refused('my branch')).toMatchObject({ code: 'invalid_request', details: [{ path: 'name', message: 'Use dashes or underscores instead of spaces' }] });
    expect((await refused('trailing-')).details[0].message).toBe('Start and end with a letter or digit');
    expect((await refused('.hidden')).details[0].message).toBe('Start and end with a letter or digit');
    expect((await refused('main')).details[0].message).toBe('main is the released line. Pick another name');
  });
});
