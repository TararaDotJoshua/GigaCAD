import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  client,
  commitVersion,
  createHarness,
  createUser,
  MACHINE,
  sha256,
  upload,
  type Client,
  type Harness,
  type TestUser,
} from './helpers.js';

let harness: Harness;
let alex: TestUser;
let bea: TestUser;
let outsider: TestUser;
let asAlex: Client;
let asBea: Client;
let asOutsider: Client;

beforeAll(async () => {
  harness = await createHarness();
  [alex, bea, outsider] = await Promise.all([
    createUser(harness, 'alex'),
    createUser(harness, 'bea'),
    createUser(harness, 'out'),
  ]);
  asAlex = client(harness, alex);
  asBea = client(harness, bea);
  asOutsider = client(harness, outsider);
});

afterAll(async () => {
  await harness?.close();
});

async function newProject(api: Client, visibility: 'public' | 'private' = 'private') {
  const response = await api.post('/v1/projects', { slug: `robot-${randomUUID().slice(0, 8)}`, name: 'Robot', visibility });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function newBranch(api: Client, projectId: string, name: string, fromRelease?: number) {
  const response = await api.post(`/v1/projects/${projectId}/branches`, { name, fromRelease });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

/**
 * Opens a release request, generates the candidate with the given picks, self-approves
 * (new projects need one approval and let a solo owner give it), and releases.
 */
async function releaseBranch(api: Client, branchId: string, picks?: object) {
  const opened = await api.post(`/v1/branches/${branchId}/release-requests`, { title: 'Release' });
  expect(opened.status).toBe(201);
  const id = opened.body.releaseRequest.id as string;
  if (picks) expect((await api.put(`/v1/release-requests/${id}/picks`, picks)).status).toBe(200);
  const candidate = await api.post(`/v1/release-requests/${id}/candidate`);
  expect(candidate.status).toBe(200);
  expect((await api.post(`/v1/release-requests/${id}/approvals`)).status).toBe(200);
  const released = await api.post(`/v1/release-requests/${id}/release`);
  expect(released.status).toBe(201);
  return released.body as { release: { id: string; number: number } };
}

describe('release workflow', () => {
  it('runs the full diff-pick scenario with a replaced part inheriting its id', async () => {
    const projectId = await newProject(asAlex);

    // v1: an assembly and four parts.
    const first = await newBranch(asAlex, projectId, 'initial');
    await commitVersion(harness, asAlex, projectId, first, {
      'Robot.SLDASM': 'asm v1',
      'parts/P1.SLDPRT': 'p1 v1',
      'parts/P2.SLDPRT': 'p2 v1',
      'parts/P4.SLDPRT': 'p4 v1',
    });
    expect((await releaseBranch(asAlex, first)).release.number).toBe(1);
    const v1 = await asAlex.get(`/v1/projects/${projectId}/releases/1`);
    const itemId = (path: string) => v1.body.files.find((file: { path: string }) => file.path === path).itemId as string;

    // Branches A and B both start from v1.
    const branchA = await newBranch(asAlex, projectId, 'A');
    const branchB = await newBranch(asAlex, projectId, 'B');

    // A edits P1 and becomes v2.
    await commitVersion(harness, asAlex, projectId, branchA, {
      'Robot.SLDASM': 'asm v1',
      'parts/P1.SLDPRT': 'p1 from A',
      'parts/P2.SLDPRT': 'p2 v1',
      'parts/P4.SLDPRT': 'p4 v1',
    });
    expect((await releaseBranch(asAlex, branchA)).release.number).toBe(2);

    // B edits P1 and P2, and makes P3 to replace P4.
    const committed = await commitVersion(harness, asAlex, projectId, branchB, {
      'Robot.SLDASM': 'asm from B',
      'parts/P1.SLDPRT': 'p1 from B',
      'parts/P2.SLDPRT': 'p2 from B',
      'parts/P3.SLDPRT': 'p3 from B',
    });
    const p3ItemId = committed.files.find((file) => file.path === 'parts/P3.SLDPRT')!.itemId;

    const opened = await asAlex.post(`/v1/branches/${branchB}/release-requests`, { title: 'Swap P4 for P3' });
    const rrId = opened.body.releaseRequest.id as string;
    const conflictRow = opened.body.preview.rows.find((row: { itemId: string }) => row.itemId === itemId('parts/P1.SLDPRT'));
    expect(conflictRow.conflict).toBe(true);

    const picked = await asAlex.put(`/v1/release-requests/${rrId}/picks`, {
      actions: { [itemId('Robot.SLDASM')]: 'keep_main', [itemId('parts/P1.SLDPRT')]: 'keep_main' },
      replacements: [{ branchItemId: p3ItemId, mainItemId: itemId('parts/P4.SLDPRT') }],
    });
    expect(picked.status).toBe(200);
    expect(picked.body.preview.errors).toEqual([]);

    expect((await asAlex.post(`/v1/release-requests/${rrId}/candidate`)).status).toBe(200);
    expect((await asAlex.post(`/v1/release-requests/${rrId}/approvals`)).status).toBe(200);
    const released = await asAlex.post(`/v1/release-requests/${rrId}/release`);
    expect(released.status).toBe(201);
    expect(released.body.release.number).toBe(3);

    const v3 = await asAlex.get(`/v1/projects/${projectId}/releases/3`);
    expect(v3.body.files).toEqual([
      { itemId: itemId('parts/P1.SLDPRT'), path: 'parts/P1.SLDPRT', blob: sha256('p1 from A') },
      { itemId: itemId('parts/P2.SLDPRT'), path: 'parts/P2.SLDPRT', blob: sha256('p2 from B') },
      { itemId: itemId('parts/P4.SLDPRT'), path: 'parts/P3.SLDPRT', blob: sha256('p3 from B') },
      { itemId: itemId('Robot.SLDASM'), path: 'Robot.SLDASM', blob: sha256('asm v1') },
    ]);

    const branch = await asAlex.get(`/v1/branches/${branchB}`);
    expect(branch.body.branch.status).toBe('released');
  });

  it('refuses to release a candidate built on an older main', async () => {
    const projectId = await newProject(asAlex);
    const first = await newBranch(asAlex, projectId, 'initial');
    await commitVersion(harness, asAlex, projectId, first, { 'A.SLDPRT': 'a1' });
    await releaseBranch(asAlex, first);

    const slow = await newBranch(asAlex, projectId, 'slow');
    const fast = await newBranch(asAlex, projectId, 'fast');
    await commitVersion(harness, asAlex, projectId, slow, { 'A.SLDPRT': 'slow' });
    const opened = await asAlex.post(`/v1/branches/${slow}/release-requests`, { title: 'Slow' });
    const rrId = opened.body.releaseRequest.id;
    await asAlex.post(`/v1/release-requests/${rrId}/candidate`);
    await asAlex.post(`/v1/release-requests/${rrId}/approvals`);

    await commitVersion(harness, asAlex, projectId, fast, { 'A.SLDPRT': 'fast' });
    await releaseBranch(asAlex, fast);

    const blocked = await asAlex.post(`/v1/release-requests/${rrId}/release`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('main_moved');

    // Regenerating picks up v2, warns that the branch overwrites it, and then releases.
    const regenerated = await asAlex.post(`/v1/release-requests/${rrId}/candidate`);
    expect(regenerated.body.preview.warnings.map((w: { kind: string }) => w.kind)).toEqual(['overwrites_main_change']);
    // The earlier approval was for the old candidate, so it no longer counts.
    const unapproved = await asAlex.post(`/v1/release-requests/${rrId}/release`);
    expect(unapproved.body.error.code).toBe('approval_required');
    await asAlex.post(`/v1/release-requests/${rrId}/approvals`);
    expect((await asAlex.post(`/v1/release-requests/${rrId}/release`)).status).toBe(201);
  });

  it('closing a release request unfreezes the branch', async () => {
    const projectId = await newProject(asAlex);
    const branch = await newBranch(asAlex, projectId, 'work');
    await commitVersion(harness, asAlex, projectId, branch, { 'A.SLDPRT': 'a' });
    const opened = await asAlex.post(`/v1/branches/${branch}/release-requests`, { title: 'Try' });
    expect((await asAlex.get(`/v1/branches/${branch}`)).body.branch.status).toBe('frozen');
    expect((await asAlex.post(`/v1/branches/${branch}/checkout`, { machine: MACHINE })).status).toBe(409);

    await asAlex.post(`/v1/release-requests/${opened.body.releaseRequest.id}/close`);
    expect((await asAlex.get(`/v1/branches/${branch}`)).body.branch.status).toBe('open');
  });
});

describe('main is permanently locked', () => {
  it('rejects edits and deletes of releases and their files at the database level', async () => {
    const projectId = await newProject(asAlex);
    const branch = await newBranch(asAlex, projectId, 'initial');
    await commitVersion(harness, asAlex, projectId, branch, { 'A.SLDPRT': 'a' });
    const { release } = await releaseBranch(asAlex, branch);
    const { sql } = harness;

    await expect(sql`update releases set notes = 'changed' where id = ${release.id}`).rejects.toThrow(/permanently locked/);
    await expect(sql`delete from releases where id = ${release.id}`).rejects.toThrow(/permanently locked/);
    await expect(
      sql`delete from manifest_entries where manifest_id = (select manifest_id from releases where id = ${release.id})`,
    ).rejects.toThrow(/permanently locked/);
    await expect(
      sql`update manifest_entries set path = 'B.SLDPRT' where manifest_id = (select manifest_id from releases where id = ${release.id})`,
    ).rejects.toThrow(/immutable/);
  });
});

describe('check-out locks', () => {
  it('lets only the lock holder save, on top of the current head', async () => {
    const projectId = await newProject(asAlex);
    await asAlex.put(`/v1/projects/${projectId}/members`, { handle: bea.handle, role: 'contributor' });
    const branch = await newBranch(asAlex, projectId, 'shared');
    const [blob] = await upload(harness, asAlex, projectId, ['part']);

    const taken = await asAlex.post(`/v1/branches/${branch}/checkout`, { machine: MACHINE });
    expect(taken.status).toBe(200);
    expect(taken.body.checkedOutByHandle).toBe(alex.handle);

    const blocked = await asBea.post(`/v1/branches/${branch}/checkout`, { machine: 'bea-pc' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({ code: 'checked_out', details: { handle: alex.handle, machine: MACHINE } });

    const commit = { parentId: taken.body.headCommitId, kind: 'autosave', files: [{ path: 'A.SLDPRT', blob }] };
    expect((await asBea.post(`/v1/branches/${branch}/commits`, { ...commit, machine: 'bea-pc' })).body.error.code).toBe('not_checked_out');
    expect((await asAlex.post(`/v1/branches/${branch}/commits`, { ...commit, machine: 'other-laptop' })).body.error.code).toBe('not_checked_out');
    expect((await asAlex.post(`/v1/branches/${branch}/commits`, { ...commit, machine: MACHINE })).status).toBe(201);
    const stale = await asAlex.post(`/v1/branches/${branch}/commits`, { ...commit, machine: MACHINE });
    expect(stale.body.error.code).toBe('stale_head');

    expect((await asBea.post(`/v1/branches/${branch}/checkin`)).status).toBe(403);
    expect((await asBea.post(`/v1/branches/${branch}/force-release`)).status).toBe(403);
  });

  it('lets maintainers force-release a stale lock and records who held it', async () => {
    const projectId = await newProject(asAlex);
    await asAlex.put(`/v1/projects/${projectId}/members`, { handle: bea.handle, role: 'maintainer' });
    const branch = await newBranch(asAlex, projectId, 'stale');
    await asAlex.post(`/v1/branches/${branch}/checkout`, { machine: MACHINE });

    const released = await asBea.post(`/v1/branches/${branch}/force-release`);
    expect(released.status).toBe(200);
    expect(released.body.checkedOutBy).toBeNull();

    const events = await asBea.get(`/v1/projects/${projectId}/events`);
    const forced = events.body.find((event: { kind: string }) => event.kind === 'branch_lock_force_released');
    expect(forced).toMatchObject({ actorId: bea.id, subjectId: branch, payload: { previousHolder: alex.id, machine: MACHINE } });

    const newest = await asBea.get(`/v1/projects/${projectId}/events?order=desc&limit=1`);
    expect(newest.body).toEqual([forced]);
  });
});

describe('autosaves', () => {
  it('are deleted, with their snapshots, when the next version is committed', async () => {
    const projectId = await newProject(asAlex);
    const branch = await newBranch(asAlex, projectId, 'work');
    const checkout = await asAlex.post(`/v1/branches/${branch}/checkout`, { machine: MACHINE });
    const blobs = await upload(harness, asAlex, projectId, ['save 1', 'save 2', 'final']);

    let parentId = checkout.body.headCommitId;
    for (const blob of blobs.slice(0, 2)) {
      const saved = await asAlex.post(`/v1/branches/${branch}/commits`, {
        parentId,
        machine: MACHINE,
        kind: 'autosave',
        files: [{ path: 'A.SLDPRT', blob }],
      });
      expect(saved.status).toBe(201);
      parentId = saved.body.commit.id;
    }
    const unchanged = await asAlex.post(`/v1/branches/${branch}/commits`, {
      parentId,
      machine: MACHINE,
      kind: 'autosave',
      files: [{ path: 'A.SLDPRT', blob: blobs[1] }],
    });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.created).toBe(false);
    expect((await asAlex.get(`/v1/branches/${branch}/commits`)).body.map((c: { kind: string }) => c.kind)).toEqual([
      'autosave',
      'autosave',
      'version',
    ]);

    const version = await asAlex.post(`/v1/branches/${branch}/commits`, {
      parentId,
      machine: MACHINE,
      kind: 'version',
      versionLabel: 'rev A',
      files: [{ path: 'A.SLDPRT', blob: blobs[2] }],
    });
    expect(version.status).toBe(201);

    const history = await asAlex.get(`/v1/branches/${branch}/commits`);
    expect(history.body.map((c: { kind: string }) => c.kind)).toEqual(['version', 'version']);
    expect(history.body[0].parentId).toBe(history.body[1].id);

    const [orphans] = await harness.sql<{ count: number }[]>`
      select count(*)::int as count from manifests m
      where m.project_id = ${projectId} and not exists (select 1 from commits c where c.manifest_id = m.id)
    `;
    expect(orphans?.count).toBe(0);
  });
});

describe('approvals', () => {
  it('follows the project rules and resets when the candidate changes', async () => {
    const projectId = await newProject(asAlex);
    await asAlex.put(`/v1/projects/${projectId}/members`, { handle: bea.handle, role: 'maintainer' });
    const rules = await asAlex.put(`/v1/projects/${projectId}/approval-rules`, {
      requiredCount: 1,
      approverUserIds: [],
      approverRoles: ['maintainer'],
      allowSelfApproval: false,
      requireCleanRebuild: true,
    });
    expect(rules.status).toBe(200);

    const branch = await newBranch(asAlex, projectId, 'work');
    await commitVersion(harness, asAlex, projectId, branch, { 'Robot.SLDASM': 'asm', 'A.SLDPRT': 'a' });
    const opened = await asAlex.post(`/v1/branches/${branch}/release-requests`, { title: 'First release' });
    const rrId = opened.body.releaseRequest.id;
    const candidate = await asAlex.post(`/v1/release-requests/${rrId}/candidate`);
    const manifestId = candidate.body.candidate.manifestId;

    expect((await asAlex.post(`/v1/release-requests/${rrId}/approvals`)).status).toBe(403);
    const blocked = await asAlex.post(`/v1/release-requests/${rrId}/release`);
    expect(blocked.body.error.code).toBe('approval_required');
    expect(blocked.body.error.details.blockers).toEqual([
      { kind: 'needs_approvals', have: 0, need: 1 },
      { kind: 'rebuild_missing' },
    ]);

    // The SolidWorks rebuild saves a new assembly, which changes the candidate.
    const [rebuilt] = await upload(harness, asAlex, projectId, ['asm rebuilt']);
    const asmItem = candidate.body.candidate.files.find((f: { path: string }) => f.path === 'Robot.SLDASM').itemId;
    const updated = await asAlex.put(`/v1/release-requests/${rrId}/candidate/files`, {
      baseManifestId: manifestId,
      files: [{ itemId: asmItem, blob: rebuilt }],
    });
    expect(updated.status).toBe(200);
    const rebuiltManifestId = updated.body.candidate.manifestId;
    expect(rebuiltManifestId).not.toBe(manifestId);

    const staleReport = await asAlex.post(`/v1/release-requests/${rrId}/rebuild-report`, {
      candidateManifestId: manifestId,
      status: 'passed',
      messages: [],
    });
    expect(staleReport.body.error.code).toBe('stale_candidate');
    await asAlex.post(`/v1/release-requests/${rrId}/rebuild-report`, {
      candidateManifestId: rebuiltManifestId,
      status: 'passed_with_warnings',
      messages: [{ level: 'warning', message: 'Mate "Concentric3" is over-defined', path: 'Robot.SLDASM' }],
    });

    expect((await asBea.post(`/v1/release-requests/${rrId}/approvals`)).status).toBe(200);
    const released = await asAlex.post(`/v1/release-requests/${rrId}/release`);
    expect(released.status).toBe(201);
    const v1 = await asAlex.get(`/v1/projects/${projectId}/releases/1`);
    expect(v1.body.files.find((f: { path: string }) => f.path === 'Robot.SLDASM').blob).toBe(rebuilt);
  });
});

describe('file access', () => {
  it('never lets a project use a file it did not upload itself', async () => {
    const alexProject = await newProject(asAlex);
    const [secret] = await upload(harness, asAlex, alexProject, ['secret bracket']);

    const beaProject = await newProject(asBea);
    const plan = await asBea.post(`/v1/projects/${beaProject}/blobs/uploads`, {
      blobs: [{ sha256: secret, size: Buffer.byteLength('secret bracket') }],
    });
    expect(plan.body.present).toEqual([]);
    expect(plan.body.uploads).toHaveLength(1);

    // Claiming the upload without sending the bytes fails.
    const claimed = await asBea.post(`/v1/projects/${beaProject}/blobs/complete`, { uploadIds: [plan.body.uploads[0].uploadId] });
    expect(claimed.body.failed).toEqual([{ uploadId: plan.body.uploads[0].uploadId, reason: 'not_uploaded' }]);

    // Sending different bytes under that hash fails the checksum.
    harness.storage.put(plan.body.uploads[0].url, 'SECRET BRACKET');
    const forged = await asBea.post(`/v1/projects/${beaProject}/blobs/complete`, { uploadIds: [plan.body.uploads[0].uploadId] });
    expect(forged.body.failed[0].reason).toBe('checksum_mismatch');

    const branch = await newBranch(asBea, beaProject, 'steal');
    const checkout = await asBea.post(`/v1/branches/${branch}/checkout`, { machine: MACHINE });
    const commit = await asBea.post(`/v1/branches/${branch}/commits`, {
      parentId: checkout.body.headCommitId,
      machine: MACHINE,
      kind: 'version',
      files: [{ path: 'Stolen.SLDPRT', blob: secret }],
    });
    expect(commit.status).toBe(422);
    expect(commit.body.error.code).toBe('missing_blobs');

    const download = await asBea.post(`/v1/projects/${beaProject}/blobs/downloads`, { sha256s: [secret] });
    expect(download.body).toEqual({ downloads: [], missing: [secret] });
  });

  it('stores each file once even when several projects upload it', async () => {
    const one = await newProject(asAlex);
    const two = await newProject(asAlex);
    const content = `shared ${randomUUID()}`;
    const staged = () => [...harness.storage.objects.keys()].filter((key) => key.startsWith('uploads/')).length;
    const stagedBefore = staged();
    await upload(harness, asAlex, one, [content]);
    await upload(harness, asAlex, two, [content]);

    const stored = [...harness.storage.objects.keys()].filter((key) => key.endsWith(sha256(content)));
    expect(stored).toHaveLength(1);
    expect(staged()).toBe(stagedBefore);
  });

  it('names downloads when asked, and refuses paths as names', async () => {
    const projectId = await newProject(asAlex);
    const blob = (await upload(harness, asAlex, projectId, [`named ${randomUUID()}`]))[0]!;
    const named = await asAlex.post(`/v1/projects/${projectId}/blobs/downloads`, { sha256s: [blob], filenames: { [blob]: 'P1.SLDPRT' } });
    expect(named.body.downloads[0].url).toContain('filename=P1.SLDPRT');
    const path = await asAlex.post(`/v1/projects/${projectId}/blobs/downloads`, { sha256s: [blob], filenames: { [blob]: 'parts/P1.SLDPRT' } });
    expect(path.status).toBe(400);
  });

  it('restores a known file whose stored copy went missing when it is uploaded again', async () => {
    const one = await newProject(asAlex);
    const two = await newProject(asAlex);
    const content = `lost ${randomUUID()}`;
    await upload(harness, asAlex, one, [content]);
    const key = [...harness.storage.objects.keys()].find((k) => k.endsWith(sha256(content)))!;
    harness.storage.objects.delete(key);

    await upload(harness, asAlex, two, [content]);
    expect(harness.storage.objects.get(key)?.toString()).toBe(content);
  });
});

describe('visibility', () => {
  it('hides private projects from outsiders and shows public ones to everyone', async () => {
    const privateId = await newProject(asAlex, 'private');
    const publicId = await newProject(asAlex, 'public');

    expect((await asOutsider.get(`/v1/projects/${privateId}`)).status).toBe(404);
    expect((await client(harness, null).get(`/v1/projects/${privateId}`)).status).toBe(404);

    const anonymous = await client(harness, null).get(`/v1/projects/${publicId}`);
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.role).toBeNull();
    expect((await asOutsider.post(`/v1/projects/${publicId}/branches`, { name: 'nope' })).status).toBe(403);
  });
});

describe('handles', () => {
  it('rejects handles that would collide with top-level pages', async () => {
    const taken = await asOutsider.patch('/v1/me', { handle: 'settings' });
    expect(taken.status).toBe(400);
    expect(taken.body.error.details).toEqual([{ path: 'handle', message: 'That handle is reserved' }]);
  });

  it('rejects handles that look like the placeholder new accounts start with', async () => {
    const placeholder = await asOutsider.patch('/v1/me', { handle: 'user-0a1b2c3d4e5f' });
    expect(placeholder.status).toBe(400);
    expect(placeholder.body.error.details).toEqual([{ path: 'handle', message: 'Choose a handle of your own' }]);
  });
});

describe('browser access', () => {
  it('lets the web app use every method the API has, and no other origin', async () => {
    const preflight = (origin: string) =>
      harness.app.inject({ method: 'OPTIONS', url: '/v1/me', headers: { origin, 'access-control-request-method': 'PATCH' } });
    const allowed = await preflight('http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(String(allowed.headers['access-control-allow-methods']).split(/,\s*/)).toEqual(expect.arrayContaining(['PUT', 'PATCH', 'DELETE']));
    expect((await preflight('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('desktop sign-in', () => {
  it('exchanges an approved code for a revocable device token', async () => {
    const anonymous = client(harness, null);
    const started = await anonymous.post('/v1/auth/device/code', { clientName: 'GigaCAD for Windows' });
    expect(started.status).toBe(200);
    expect(started.body.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const details = await asAlex.get(`/v1/auth/device/pending/${started.body.userCode}`);
    expect(details.status).toBe(200);
    expect(details.body.clientName).toBe('GigaCAD for Windows');
    expect((await anonymous.get(`/v1/auth/device/pending/${started.body.userCode}`)).status).toBe(401);

    const pending = await anonymous.post('/v1/auth/device/token', { deviceCode: started.body.deviceCode });
    expect(pending.body.error.code).toBe('authorization_pending');

    expect((await asAlex.post('/v1/auth/device/approve', { userCode: started.body.userCode.toLowerCase() })).status).toBe(200);
    expect((await asAlex.get(`/v1/auth/device/pending/${started.body.userCode}`)).status).toBe(404);
    const granted = await anonymous.post('/v1/auth/device/token', { deviceCode: started.body.deviceCode });
    expect(granted.status).toBe(200);
    expect(granted.body.tokenId).toMatch(/^[0-9a-f-]{36}$/);
    const device = { ...alex, token: granted.body.accessToken as string };
    const asDevice = client(harness, device);

    expect((await anonymous.post('/v1/auth/device/token', { deviceCode: started.body.deviceCode })).body.error.code).toBe('invalid_grant');
    expect((await asDevice.get('/v1/me')).body.handle).toBe(alex.handle);

    // A device token can't approve more sign-ins or mint more tokens.
    const another = await anonymous.post('/v1/auth/device/code', { clientName: 'Sneaky' });
    expect((await asDevice.post('/v1/auth/device/approve', { userCode: another.body.userCode })).status).toBe(403);
    expect((await asDevice.post('/v1/auth/tokens', { name: 'more' })).status).toBe(403);

    const tokens = await asAlex.get('/v1/me/tokens');
    const tokenId = tokens.body.find((t: { name: string }) => t.name === 'GigaCAD for Windows').id;
    expect(tokenId).toBe(granted.body.tokenId);
    // A device can sign itself out by revoking its own token.
    expect((await asDevice.delete(`/v1/me/tokens/${tokenId}`)).status).toBe(204);
    expect((await asDevice.get('/v1/me')).status).toBe(401);
  });
});
