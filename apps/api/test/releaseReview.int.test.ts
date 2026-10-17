import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { snapshotMissingReleaseExports } from '../src/jobs.js';
import { call, client, commitVersion, createHarness, createUser, MACHINE, sha256, upload, type Client, type Harness, type TestUser } from './helpers.js';

/**
 * The review loop around a release request: approvals and releases bound to the candidate
 * the reviewer saw, finished requests that never change, rebuilds that can't hide, and
 * releases that keep their exports. From the 2026-10-15 web audit.
 */

let harness: Harness;
let alex: TestUser;
let bea: TestUser;
let cam: TestUser;
let vic: TestUser;
let asAlex: Client;
let asBea: Client;
let asCam: Client;
let asVic: Client;

beforeAll(async () => {
  harness = await createHarness();
  [alex, bea, cam, vic] = await Promise.all([createUser(harness, 'alex'), createUser(harness, 'bea'), createUser(harness, 'cam'), createUser(harness, 'vic')]);
  asAlex = client(harness, alex);
  asBea = client(harness, bea);
  asCam = client(harness, cam);
  asVic = client(harness, vic);
});

afterAll(async () => {
  await harness?.close();
});

/** A project owned by Alex, with Bea as maintainer, Cam as contributor and Vic as viewer, and v1 released. */
async function team(files: Record<string, string> = { 'Robot.SLDASM': `asm ${randomUUID()}`, 'parts/Wheel.SLDPRT': 'wheel v1' }) {
  const projectId = (await asAlex.post('/v1/projects', { slug: `review-${randomUUID().slice(0, 8)}`, name: 'Review' })).body.id as string;
  for (const [user, role] of [
    [bea, 'maintainer'],
    [cam, 'contributor'],
    [vic, 'viewer'],
  ] as const) {
    expect((await asAlex.put(`/v1/projects/${projectId}/members`, { handle: user.handle, role })).status).toBe(200);
  }
  const initial = (await asAlex.post(`/v1/projects/${projectId}/branches`, { name: 'initial' })).body.id as string;
  await commitVersion(harness, asAlex, projectId, initial, files);
  const opened = await asAlex.post(`/v1/branches/${initial}/release-requests`, { title: 'First' });
  const reviewed = { candidateManifestId: opened.body.candidate.manifestId };
  expect((await asAlex.post(`/v1/release-requests/${opened.body.releaseRequest.id}/approvals`, reviewed)).status).toBe(200);
  expect((await asAlex.post(`/v1/release-requests/${opened.body.releaseRequest.id}/release`, reviewed)).status).toBe(201);
  return projectId;
}

/** A branch from v1 with the given files committed, and a release request opened on it by `as`. */
async function requestOn(projectId: string, as: Client, files: Record<string, string>) {
  const branch = (await as.post(`/v1/projects/${projectId}/branches`, { name: `work-${randomUUID().slice(0, 6)}`, fromRelease: 1 })).body.id as string;
  await commitVersion(harness, as, projectId, branch, files);
  const opened = await as.post(`/v1/branches/${branch}/release-requests`, { title: 'Change the wheel' });
  expect(opened.status).toBe(201);
  return { branch, id: opened.body.releaseRequest.id as string, detail: opened.body };
}

describe('approving and releasing what was reviewed', () => {
  it('builds the candidate on open, and refuses approvals and releases of a candidate that has changed since', async () => {
    const projectId = await team();
    const { id, detail } = await requestOn(projectId, asCam, { 'Robot.SLDASM': 'asm', 'parts/Wheel.SLDPRT': 'wheel v2' });
    // Every client lands on the same step: the candidate is already built from the default picks.
    expect(detail.releaseRequest.status).toBe('candidate');
    const seen = detail.candidate.manifestId as string;

    // A malformed candidate id is refused rather than approving whatever is current.
    expect((await asBea.post(`/v1/release-requests/${id}/approvals`, { candidateManifestId: 'latest' })).status).toBe(400);

    // The requester regenerates while Bea is looking at the old one.
    const fresh = (await asCam.post(`/v1/release-requests/${id}/candidate`)).body.candidate.manifestId as string;
    expect(fresh).not.toBe(seen);
    const stale = await asBea.post(`/v1/release-requests/${id}/approvals`, { candidateManifestId: seen });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'stale_candidate', details: { candidateManifestId: fresh } });

    expect((await asBea.post(`/v1/release-requests/${id}/approvals`, { candidateManifestId: fresh })).status).toBe(200);
    const staleRelease = await asCam.post(`/v1/release-requests/${id}/release`, { candidateManifestId: seen });
    expect(staleRelease.body.error.code).toBe('stale_candidate');
    expect((await asCam.post(`/v1/release-requests/${id}/release`, { candidateManifestId: fresh })).status).toBe(201);
  });

  it('still lets clients that name no candidate approve and release the current one', async () => {
    // Desktop apps and `giga` CLIs installed before candidate ids existed post an empty body.
    const projectId = await team();
    const { id, detail } = await requestOn(projectId, asCam, { 'Robot.SLDASM': 'asm', 'parts/Wheel.SLDPRT': 'wheel v2' });
    const approved = await asBea.post(`/v1/release-requests/${id}/approvals`, {});
    expect(approved.status).toBe(200);
    expect(approved.body.approvals.given).toMatchObject([{ userId: bea.id, candidateManifestId: detail.candidate.manifestId }]);
    const released = await asCam.post(`/v1/release-requests/${id}/release`, {});
    expect(released.status).toBe(201);
    expect(released.body.release.number).toBe(2);
  });

  it('stops counting approvals given before an export of a candidate file changed', async () => {
    const projectId = await team();
    const { id, detail } = await requestOn(projectId, asCam, { 'Robot.SLDASM': 'asm', 'parts/Wheel.SLDPRT': 'wheel for exports' });
    const reviewed = { candidateManifestId: detail.candidate.manifestId };
    await asBea.post(`/v1/release-requests/${id}/approvals`, reviewed);

    // After the approval, a contributor attaches a STEP to a file in the candidate. The release would lock it in.
    const [step] = (await upload(harness, asCam, projectId, [`ISO-10303-21; ${randomUUID()}`])) as [string];
    expect((await asCam.put(`/v1/projects/${projectId}/exports`, { source: sha256('wheel for exports'), format: 'step', blob: step })).status).toBe(200);
    const after = (await asCam.get(`/v1/release-requests/${id}`)).body;
    expect(after.approvals.evaluation.countedUserIds).toEqual([]);
    expect(after.approvals.exportsChangedAt).toBeTruthy();
    expect((await asCam.post(`/v1/release-requests/${id}/release`, reviewed)).body.error.code).toBe('approval_required');

    // Approving again covers the export, and the release keeps it.
    await asBea.post(`/v1/release-requests/${id}/approvals`, reviewed);
    expect((await asCam.post(`/v1/release-requests/${id}/release`, reviewed)).status).toBe(201);
    const lookup = await asVic.post(`/v1/projects/${projectId}/exports/lookup`, { sha256s: [sha256('wheel for exports')], releaseNumber: 2 });
    expect(lookup.body.exports[sha256('wheel for exports')]).toMatchObject([{ format: 'step', sha256: step }]);
  });

  it('lets a viewer named as an approver approve, but only the requester or a maintainer release', async () => {
    const projectId = await team();
    await asAlex.put(`/v1/projects/${projectId}/approval-rules`, { requiredCount: 1, approverUserIds: [vic.id], approverRoles: [], allowSelfApproval: false, requireCleanRebuild: false });
    const { id, detail } = await requestOn(projectId, asCam, { 'Robot.SLDASM': 'asm', 'parts/Wheel.SLDPRT': 'wheel v2' });
    const reviewed = { candidateManifestId: detail.candidate.manifestId };

    expect((await asVic.post(`/v1/release-requests/${id}/approvals`, reviewed)).status).toBe(200);
    expect((await asVic.post(`/v1/release-requests/${id}/release`, reviewed)).status).toBe(403);
    expect((await asBea.post(`/v1/release-requests/${id}/release`, reviewed)).status).toBe(201);
  });

  it('refuses a release, or a candidate, that would leave main as it is', async () => {
    const projectId = await team({ 'parts/Wheel.SLDPRT': 'same' });
    const { id, detail } = await requestOn(projectId, asAlex, { 'parts/Wheel.SLDPRT': 'same' });
    expect(detail.changesMain).toBe(false);
    expect(detail.candidate).toBeNull();
    expect((await asAlex.post(`/v1/release-requests/${id}/candidate`)).body.error.code).toBe('no_changes');
  });
});

describe('finished requests', () => {
  it('keep their approvals and the rules they were decided under', async () => {
    const projectId = await team();
    const { id, detail } = await requestOn(projectId, asCam, { 'Robot.SLDASM': 'asm', 'parts/Wheel.SLDPRT': 'wheel v2' });
    const reviewed = { candidateManifestId: detail.candidate.manifestId };
    await asBea.post(`/v1/release-requests/${id}/approvals`, reviewed);
    expect((await asCam.post(`/v1/release-requests/${id}/release`, reviewed)).status).toBe(201);

    // Nothing about a released request can change: not its approvals, nor another release.
    const withdrawn = await asBea.delete(`/v1/release-requests/${id}/approvals`);
    expect(withdrawn.status).toBe(409);
    expect(withdrawn.body.error).toMatchObject({ code: 'release_request_finished', details: { status: 'released', releaseNumber: 2 } });
    expect(withdrawn.body.error.message).toBe('This release request was already released as v2');
    expect((await asBea.post(`/v1/release-requests/${id}/approvals`, reviewed)).body.error.code).toBe('release_request_finished');
    expect((await asCam.post(`/v1/release-requests/${id}/release`, reviewed)).body.error.code).toBe('release_request_finished');

    // Later rule changes don't re-judge it.
    await asAlex.put(`/v1/projects/${projectId}/approval-rules`, { requiredCount: 2, approverUserIds: [], approverRoles: ['owner'], allowSelfApproval: false, requireCleanRebuild: true });
    const after = (await asVic.get(`/v1/release-requests/${id}`)).body;
    expect(after.approvals.rules).toMatchObject({ requiredCount: 1, approverRoles: ['owner', 'maintainer'] });
    expect(after.approvals.evaluation).toMatchObject({ canRelease: true, countedUserIds: [bea.id] });
    expect(after.releasedRelease).toMatchObject({ number: 2, createdByHandle: cam.handle });
  });

  it('read as they were decided even without a recorded review, and hide named approvers from outsiders', async () => {
    const projectId = await team();
    await asAlex.patch(`/v1/projects/${projectId}`, { visibility: 'public' });
    await asAlex.put(`/v1/projects/${projectId}/approval-rules`, { requiredCount: 1, approverUserIds: [bea.id], approverRoles: [], allowSelfApproval: false, requireCleanRebuild: false });
    const { id, detail } = await requestOn(projectId, asCam, { 'Robot.SLDASM': 'asm', 'parts/Wheel.SLDPRT': 'wheel v2' });
    expect((await client(harness, null).get(`/v1/release-requests/${id}`)).body.approvals.rules.approverUserIds).toEqual([]);
    expect((await asVic.get(`/v1/release-requests/${id}`)).body.approvals.rules.approverUserIds).toEqual([bea.id]);

    const reviewed = { candidateManifestId: detail.candidate.manifestId };
    await asBea.post(`/v1/release-requests/${id}/approvals`, reviewed);
    expect((await asCam.post(`/v1/release-requests/${id}/release`, reviewed)).status).toBe(201);
    // Requests released before reviews were recorded have no snapshot; today's rules don't judge them.
    await harness.sql`update release_requests set review_snapshot = null where id = ${id}`;
    await asAlex.put(`/v1/projects/${projectId}/approval-rules`, { requiredCount: 2, approverUserIds: [], approverRoles: ['owner'], allowSelfApproval: false, requireCleanRebuild: false });
    const after = (await asVic.get(`/v1/release-requests/${id}`)).body;
    expect(after.approvals.rules).toBeNull();
    expect(after.approvals.evaluation).toMatchObject({ canRelease: true, countedUserIds: [bea.id], blockers: [] });
  });

  it('say who closed them and what the branch is doing now', async () => {
    const projectId = await team();
    const { id, branch } = await requestOn(projectId, asCam, { 'Robot.SLDASM': 'asm', 'parts/Wheel.SLDPRT': 'wheel v2' });
    await asCam.post(`/v1/release-requests/${id}/close`);
    // Work on the reopened branch isn't a rebuild of the closed request's candidate.
    await commitVersion(harness, asCam, projectId, branch, { 'Robot.SLDASM': 'asm edited later', 'parts/Wheel.SLDPRT': 'wheel v3' });
    expect((await asCam.get(`/v1/release-requests/${id}`)).body.candidate.rebuilt).toEqual([]);
    const reopened = await asCam.post(`/v1/branches/${branch}/release-requests`, { title: 'Again' });

    const closed = (await asCam.get(`/v1/release-requests/${id}`)).body;
    expect(closed.history.closed).toMatchObject({ actorHandle: cam.handle });
    expect(closed.branch).toEqual({ status: 'frozen', activeRequestNumber: reopened.body.releaseRequest.number, baseReleaseNumber: 1 });
  });
});

describe('rebuilds', () => {
  it('show the files the rebuild changed, and skip uploads that change nothing', async () => {
    const projectId = await team();
    const { id, detail } = await requestOn(projectId, asCam, { 'Robot.SLDASM': 'asm', 'parts/Wheel.SLDPRT': 'wheel v2' });
    const files = detail.candidate.files as { itemId: string; path: string; blob: string }[];
    const asm = files.find((file) => file.path === 'Robot.SLDASM')!;
    const wheel = files.find((file) => file.path === 'parts/Wheel.SLDPRT')!;
    const reviewed = { candidateManifestId: detail.candidate.manifestId };
    await asBea.post(`/v1/release-requests/${id}/approvals`, reviewed);

    // Sending files that are already there, or none, leaves the candidate and its approval alone.
    expect((await asCam.put(`/v1/release-requests/${id}/candidate/files`, { baseManifestId: reviewed.candidateManifestId, files: [] })).status).toBe(400);
    const same = await asCam.put(`/v1/release-requests/${id}/candidate/files`, { baseManifestId: reviewed.candidateManifestId, files: [{ itemId: wheel.itemId, blob: wheel.blob }] });
    expect(same.body.candidate.manifestId).toBe(reviewed.candidateManifestId);
    expect(same.body.approvals.evaluation.countedUserIds).toEqual([bea.id]);

    // The add-in saves a rebuilt assembly, which the request now lists apart from the picks.
    const [rebuilt] = await upload(harness, asCam, projectId, ['asm rebuilt']);
    const updated = await asCam.put(`/v1/release-requests/${id}/candidate/files`, { baseManifestId: reviewed.candidateManifestId, files: [{ itemId: asm.itemId, blob: rebuilt }] });
    expect(updated.body.candidate.rebuilt).toEqual([{ itemId: asm.itemId, path: 'Robot.SLDASM', blob: rebuilt, builtBlob: asm.blob }]);
    expect(updated.body.approvals.evaluation.countedUserIds).toEqual([]);
    expect(updated.body.history.lastCandidateChange).toMatchObject({ kind: 'candidate_updated', actorHandle: cam.handle });
  });

  it('can’t pass with errors, and come back summarized, most severe first, with who filed them', async () => {
    const projectId = await team();
    const { id, detail } = await requestOn(projectId, asCam, { 'Robot.SLDASM': 'asm', 'parts/Wheel.SLDPRT': 'wheel v2' });
    const candidateManifestId = detail.candidate.manifestId;
    const report = (status: string, messages: object[]) => asCam.post(`/v1/release-requests/${id}/rebuild-report`, { candidateManifestId, status, messages });

    expect((await report('passed', [{ level: 'info', message: '   ' }])).status).toBe(400);
    const messages = [
      ...Array.from({ length: 60 }, (_, index) => ({ level: 'info', message: `Note ${index}` })),
      { level: 'warning', message: 'Mate is over-defined', path: 'Robot.SLDASM' },
      { level: 'error', message: '  Rebuild error  ', path: 'parts/‮Wheel.SLDPRT' },
    ];
    const filed = await report('passed', messages);
    expect(filed.status).toBe(200);
    const request = filed.body.releaseRequest;
    expect(request.rebuildStatus).toBe('failed');
    expect(request.rebuildReportedByHandle).toBe(cam.handle);
    expect(request.rebuildReportedAt).toBeTruthy();
    expect(request.rebuildReport.total).toBe(62);
    expect(request.rebuildReport.counts).toEqual({ error: 1, warning: 1, info: 60 });
    expect(request.rebuildReport.messages).toHaveLength(50);
    expect(request.rebuildReport.messages.slice(0, 2)).toEqual([
      { level: 'error', message: 'Rebuild error', path: 'parts/Wheel.SLDPRT' },
      { level: 'warning', message: 'Mate is over-defined', path: 'Robot.SLDASM' },
    ]);

    // Outsiders of a public project see who reported it, but not their member id or device's name.
    await asAlex.patch(`/v1/projects/${projectId}`, { visibility: 'public' });
    const started = await client(harness, null).post('/v1/auth/device/code', { clientName: 'giga CLI on Cams-MacBook-Pro' });
    await asCam.post('/v1/auth/device/approve', { userCode: started.body.userCode });
    const device = (await client(harness, null).post('/v1/auth/device/token', { deviceCode: started.body.deviceCode })).body.accessToken as string;
    expect((await call(harness, device, 'POST', `/v1/release-requests/${id}/rebuild-report`, { candidateManifestId, status: 'failed', messages })).status).toBe(200);
    const member = (await asVic.get(`/v1/release-requests/${id}`)).body.releaseRequest;
    expect(member.rebuildReport).toMatchObject({ via: 'device', deviceName: 'giga CLI on Cams-MacBook-Pro', reportedBy: { userId: cam.id, handle: cam.handle } });
    const outsider = (await client(harness, null).get(`/v1/release-requests/${id}`)).body.releaseRequest;
    expect(outsider.rebuildReport.via).toBe('device');
    expect(outsider.rebuildReport.deviceName).toBeUndefined();
    expect(outsider.rebuildReport.reportedBy).toEqual({ handle: cam.handle });
    expect(outsider.rebuildReportedBy).toBeNull();
    expect(JSON.stringify(outsider)).not.toContain('Cams-MacBook-Pro');

    const page = await asVic.get(`/v1/release-requests/${id}/rebuild-report?offset=50&limit=20`);
    expect(page.body).toMatchObject({ status: 'failed', total: 62 });
    expect(page.body.messages.map((message: { message: string }) => message.message)).toEqual(Array.from({ length: 12 }, (_, index) => `Note ${index + 48}`));

    expect((await report('passed', [{ level: 'warning', message: 'Slow' }])).body.releaseRequest.rebuildStatus).toBe('passed_with_warnings');
  });
});

describe('the request list', () => {
  it('says when a candidate is out of date or its rebuild failed', async () => {
    const projectId = await team();
    const slow = await requestOn(projectId, asCam, { 'Robot.SLDASM': 'asm', 'parts/Wheel.SLDPRT': 'wheel slow' });
    await asCam.post(`/v1/release-requests/${slow.id}/rebuild-report`, { candidateManifestId: slow.detail.candidate.manifestId, status: 'failed', messages: [] });
    let row = (await asVic.get(`/v1/projects/${projectId}/release-requests`)).body.find((request: { id: string }) => request.id === slow.id);
    expect(row).toMatchObject({ upToDate: true, rebuildStatus: 'failed', candidateManifestId: slow.detail.candidate.manifestId });

    const fast = await requestOn(projectId, asAlex, { 'Robot.SLDASM': 'asm', 'parts/Wheel.SLDPRT': 'wheel fast' });
    const reviewed = { candidateManifestId: fast.detail.candidate.manifestId };
    await asBea.post(`/v1/release-requests/${fast.id}/approvals`, reviewed);
    expect((await asAlex.post(`/v1/release-requests/${fast.id}/release`, reviewed)).status).toBe(201);
    row = (await asVic.get(`/v1/projects/${projectId}/release-requests`)).body.find((request: { id: string }) => request.id === slow.id);
    expect(row.upToDate).toBe(false);
  });
});

describe('opening a request on unsaved autosaves', () => {
  it('saves them as a version credited to whoever made them', async () => {
    const projectId = await team();
    const branch = (await asCam.post(`/v1/projects/${projectId}/branches`, { name: 'autosaved', fromRelease: 1 })).body.id as string;
    const checkout = await asCam.post(`/v1/branches/${branch}/checkout`, { machine: MACHINE });
    let parentId = checkout.body.headCommitId as string;
    for (const blob of await upload(harness, asCam, projectId, ['wheel save 1', 'wheel save 2'])) {
      parentId = (await asCam.post(`/v1/branches/${branch}/commits`, { parentId, machine: MACHINE, kind: 'autosave', files: [{ path: 'parts/Wheel.SLDPRT', blob }] })).body.commit.id;
    }
    await asCam.post(`/v1/branches/${branch}/checkin`);

    // Bea, a maintainer, opens the request; the autosaves are still Cam's work.
    const opened = await asBea.post(`/v1/branches/${branch}/release-requests`, { title: 'Ship the autosaves' });
    expect(opened.body.history.snapshot).toEqual({ autosaves: 2, authorHandle: cam.handle });
    const [head] = (await asBea.get(`/v1/branches/${branch}/commits`)).body;
    expect(head).toMatchObject({ kind: 'version', authorId: cam.id });
  });
});

describe('released exports', () => {
  it('stay as they were when the release was made, while the current one can be replaced', async () => {
    const part = `wheel ${randomUUID()}`;
    const projectId = await team({ 'parts/Wheel.SLDPRT': 'wheel v1' });
    const branch = (await asCam.post(`/v1/projects/${projectId}/branches`, { name: 'exports', fromRelease: 1 })).body.id as string;
    await commitVersion(harness, asCam, projectId, branch, { 'parts/Wheel.SLDPRT': part });
    const [first, second, stl] = (await upload(harness, asCam, projectId, [`ISO-10303-21; first ${part}`, `ISO-10303-21; second ${part}`, `solid ${part}`])) as [string, string, string];
    expect((await asCam.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'step', blob: first })).status).toBe(200);
    expect((await asCam.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'stl', blob: stl })).status).toBe(200);

    const opened = await asCam.post(`/v1/branches/${branch}/release-requests`, { title: 'New wheel' });
    const reviewed = { candidateManifestId: opened.body.candidate.manifestId };
    await asBea.post(`/v1/release-requests/${opened.body.releaseRequest.id}/approvals`, reviewed);
    expect((await asCam.post(`/v1/release-requests/${opened.body.releaseRequest.id}/release`, reviewed)).status).toBe(201);

    // A contributor swaps the current export after the release.
    expect((await asCam.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'step', blob: second })).status).toBe(200);
    const lookup = (releaseNumber?: number) => asVic.post(`/v1/projects/${projectId}/exports/lookup`, { sha256s: [sha256(part)], ...(releaseNumber ? { releaseNumber } : {}) });
    expect((await lookup()).body.exports[sha256(part)]).toMatchObject([{ format: 'step', sha256: second }, { format: 'stl', sha256: stl }]);
    expect((await lookup(2)).body.exports[sha256(part)]).toMatchObject([{ format: 'step', sha256: first }, { format: 'stl', sha256: stl }]);
    expect((await lookup(1)).body.exports).toEqual({});
    expect((await lookup(9)).status).toBe(404);

    // The swap is on the record, and the released copy can't be edited or deleted.
    const events = (await asVic.get(`/v1/projects/${projectId}/events?order=desc&limit=5`)).body as { kind: string; actorId: string; payload: Record<string, unknown> }[];
    expect(events.find((event) => event.kind === 'export_replaced')).toMatchObject({ actorId: cam.id, payload: { path: 'parts/Wheel.SLDPRT', format: 'step', blob: second, previousBlob: first } });
    await expect(harness.sql`update release_exports set blob_sha256 = ${second} where project_id = ${projectId}`).rejects.toThrow(/permanently locked/);
    await expect(harness.sql`delete from release_exports where project_id = ${projectId}`).rejects.toThrow(/permanently locked/);

    // Thumbnails drawn from the exports follow the same split: the release keeps its own.
    // An STL draws the thumbnail when it has one; otherwise the STEP does.
    await harness.sql`update thumbnails set status = 'ready' where blob_sha256 in (${first}, ${second}, ${stl})`;
    const thumbnail = async (releaseNumber?: number) =>
      (await asVic.post(`/v1/projects/${projectId}/thumbnails`, { sha256s: [sha256(part)], ...(releaseNumber ? { releaseNumber } : {}) })).body.thumbnails[sha256(part)] as string;
    expect(await thumbnail(2)).toContain(stl);
    await harness.sql`update thumbnails set status = 'failed' where blob_sha256 = ${stl}`;
    expect(await thumbnail()).toContain(second);
    expect(await thumbnail(2)).toContain(first);
  });

  it('are copied by the jobs for releases an older API made without them', async () => {
    const part = `axle ${randomUUID()}`;
    const projectId = await team({ 'parts/Axle.SLDPRT': part });
    const [step] = (await upload(harness, asAlex, projectId, [`ISO-10303-21; ${part}`])) as [string];
    expect((await asAlex.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'step', blob: step })).status).toBe(200);
    // As if the previous API had made v1 after the schema change: no copy, and no mark.
    await harness.sql.begin(async (tx) => {
      await tx`select set_config('gigacad.purge', 'on', true)`;
      await tx`delete from release_exports where project_id = ${projectId}`;
      await tx`delete from release_export_snapshots where release_id in (select id from releases where project_id = ${projectId})`;
    });
    expect(await snapshotMissingReleaseExports(harness.sql)).toBeGreaterThanOrEqual(1);
    const lookup = await asAlex.post(`/v1/projects/${projectId}/exports/lookup`, { sha256s: [sha256(part)], releaseNumber: 1 });
    expect(lookup.body.exports[sha256(part)]).toMatchObject([{ format: 'step', sha256: step }]);
    // Each release is copied once; a later export doesn't join it.
    const [marked] = await harness.sql`select 1 from release_export_snapshots s join releases r on r.id = s.release_id where r.project_id = ${projectId}`;
    expect(marked).toBeDefined();
  });
});

describe('release folders', () => {
  it('show when each file last changed and who made the change, not who clicked Release', async () => {
    const projectId = await team({ 'Robot.SLDASM': 'asm v1', 'parts/Wheel.SLDPRT': 'wheel v1' });
    const { id, detail } = await requestOn(projectId, asCam, { 'Robot.SLDASM': 'asm v1', 'parts/Wheel.SLDPRT': 'wheel v2' });
    const reviewed = { candidateManifestId: detail.candidate.manifestId };
    await asBea.post(`/v1/release-requests/${id}/approvals`, reviewed);
    expect((await asBea.post(`/v1/release-requests/${id}/release`, reviewed)).status).toBe(201);

    const v1 = (await asVic.get(`/v1/projects/${projectId}/releases/1`)).body.release;
    const root = await asVic.get(`/v1/projects/${projectId}/directory?path=${encodeURIComponent('Releases/v2')}`);
    const asm = root.body.entries.find((item: { name: string }) => item.name === 'Robot.SLDASM');
    expect(asm).toMatchObject({ modifiedByHandle: alex.handle, modifiedAt: v1.createdAt });
    const parts = await asVic.get(`/v1/projects/${projectId}/directory?path=${encodeURIComponent('Releases/v2/parts')}`);
    expect(parts.body.entries.find((item: { name: string }) => item.name === 'Wheel.SLDPRT')).toMatchObject({ modifiedByHandle: cam.handle });
  });
});
