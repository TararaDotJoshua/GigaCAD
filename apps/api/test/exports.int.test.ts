import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetExportDrawnThumbnails, unlinkUnusedBlobs } from '../src/jobs.js';
import { thumbnailKey } from '../src/storage.js';
import { inlineRenderer } from '../src/thumbnails/index.js';
import { generateThumbnails } from '../src/thumbnails/job.js';
import { client, commitVersion, createHarness, createUser, sha256, upload, type Client, type Harness, type TestUser } from './helpers.js';

let harness: Harness;
let owner: TestUser;
let viewer: TestUser;
let api: Client;
let asViewer: Client;

beforeAll(async () => {
  harness = await createHarness();
  [owner, viewer] = await Promise.all([createUser(harness, 'exporter'), createUser(harness, 'looker')]);
  api = client(harness, owner);
  asViewer = client(harness, viewer);
});

afterAll(async () => {
  await harness?.close();
});

function tetrahedron(): string {
  const tag = randomUUID();
  const facet = (a: string, b: string, c: string) => `facet normal 0 0 0\nouter loop\nvertex ${a}\nvertex ${b}\nvertex ${c}\nendloop\nendfacet`;
  return [`solid ${tag}`, facet('0 0 0', '10 0 0', '0 10 0'), facet('0 0 0', '0 0 10', '10 0 0'), facet('0 0 0', '0 10 0', '0 0 10'), facet('10 0 0', '0 0 10', '0 10 0'), `endsolid ${tag}`].join('\n');
}

/** A project with a SolidWorks part and a drawing. The part isn't a real SolidWorks file, so it has no preview picture. */
async function project(visibility: 'public' | 'private' = 'private') {
  const slug = `exports-${randomUUID().slice(0, 8)}`;
  const created = await api.post('/v1/projects', { slug, name: 'Exports', visibility });
  const projectId = created.body.id as string;
  await api.put(`/v1/projects/${projectId}/members`, { handle: viewer.handle, role: 'viewer' });
  const branch = await api.post(`/v1/projects/${projectId}/branches`, { name: 'work' });
  const [part, drawing] = [`part ${randomUUID()}`, `drawing ${randomUUID()}`];
  await commitVersion(harness, api, projectId, branch.body.id, { 'Bracket.SLDPRT': part, 'Bracket.SLDDRW': drawing });
  return { projectId, branchId: branch.body.id as string, part, drawing };
}

const thumbnail = async (content: string) =>
  (await harness.sql<{ status: string; error: string | null }[]>`
    select status, error from thumbnails where blob_sha256 = ${sha256(content)}
  `)[0];
/** The image a project shows for a file, by the hash it was drawn from. */
const shown = async (as: Client, projectId: string, content: string) => {
  const links = await as.post(`/v1/projects/${projectId}/thumbnails`, { sha256s: [sha256(content)] });
  return links.body.thumbnails[sha256(content)] as string | undefined;
};
/** Opens, builds, approves and releases v1 from a branch. */
async function releaseV1(projectId: string, branchId: string) {
  const opened = await api.post(`/v1/branches/${branchId}/release-requests`, { title: 'v1' });
  const requestId = opened.body.releaseRequest.id;
  const candidateManifestId = (await api.post(`/v1/release-requests/${requestId}/candidate`)).body.candidate.manifestId;
  await api.post(`/v1/release-requests/${requestId}/approvals`, { candidateManifestId });
  expect((await api.post(`/v1/release-requests/${requestId}/release`, { candidateManifestId })).status).toBe(201);
}

const render = () => generateThumbnails({ sql: harness.sql, storage: harness.storage, renderer: inlineRenderer }, { budgetMs: 30_000 });

describe('SolidWorks exports', () => {
  it('turn a SolidWorks part’s STL into its thumbnail, and can be looked up and downloaded', async () => {
    const { projectId, part } = await project();
    // Without a preview picture inside, the part's thumbnail fails, with a reason.
    await render();
    expect(await thumbnail(part)).toMatchObject({ status: 'failed', error: expect.stringContaining('no preview picture') });

    const stl = tetrahedron();
    const [stlHash] = (await upload(harness, api, projectId, [stl])) as [string];
    const added = await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'stl', blob: stlHash });
    expect(added.status).toBe(200);
    expect(added.body).toEqual({ format: 'stl', sha256: stlHash, size: Buffer.byteLength(stl) });
    // The export is drawn as its own file; the part's own thumbnail row is left alone.
    expect(await thumbnail(stl)).toMatchObject({ status: 'pending' });
    expect(await thumbnail(part)).toMatchObject({ status: 'failed' });
    // Open pages refresh on project events, so they show the new export.
    const [event] = (await asViewer.get(`/v1/projects/${projectId}/events?order=desc&limit=1`)).body;
    expect(event).toMatchObject({ kind: 'export_attached', actorId: owner.id, payload: { source: sha256(part), format: 'stl', blob: stlHash } });

    await render();
    expect(await thumbnail(stl)).toMatchObject({ status: 'ready', error: null });
    expect(harness.storage.objects.get(thumbnailKey(stlHash))?.subarray(1, 4).toString()).toBe('PNG');
    expect(await shown(asViewer, projectId, part)).toContain(thumbnailKey(stlHash));

    const lookup = await asViewer.post(`/v1/projects/${projectId}/exports/lookup`, { sha256s: [sha256(part)] });
    expect(lookup.body).toEqual({ exports: { [sha256(part)]: [{ format: 'stl', sha256: stlHash, size: Buffer.byteLength(stl) }] } });
    const download = await asViewer.post(`/v1/projects/${projectId}/blobs/downloads`, { sha256s: [stlHash], filenames: { [stlHash]: 'Bracket.stl' } });
    expect(download.body.downloads).toHaveLength(1);

    // A STEP added later doesn't take over from the STL for the thumbnail.
    const [stepHash] = (await upload(harness, api, projectId, [`ISO-10303-21; ${randomUUID()}`])) as [string];
    expect((await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'step', blob: stepHash })).status).toBe(200);
    // The fixture isn't a real STEP file, so mark its thumbnail ready: both exports now have one.
    await harness.sql`update thumbnails set status = 'ready', error = null where blob_sha256 = ${stepHash}`;
    expect(await shown(api, projectId, part)).toContain(thumbnailKey(stlHash));
    const both = await api.post(`/v1/projects/${projectId}/exports/lookup`, { sha256s: [sha256(part)] });
    expect(both.body.exports[sha256(part)].map((entry: { format: string }) => entry.format)).toEqual(['step', 'stl']);

    // Exports stay stored while their source file does.
    await unlinkUnusedBlobs(harness.sql, { graceHours: 0 });
    const [kept] = await harness.sql`select 1 from project_blobs where project_id = ${projectId} and sha256 = ${stlHash}`;
    expect(kept).toBeDefined();

    // Without the STL, the STEP's thumbnail is shown.
    await harness.sql`delete from file_exports where project_id = ${projectId} and source_sha256 = ${sha256(part)} and format = 'stl'`;
    expect(await shown(api, projectId, part)).toContain(thumbnailKey(stepHash));
  });

  it('only attach to SolidWorks parts and assemblies in the project, from contributors', async () => {
    const { projectId, part, drawing } = await project();
    const [stlHash] = (await upload(harness, api, projectId, [tetrahedron()])) as [string];
    const put = (as: Client, body: object) => as.put(`/v1/projects/${projectId}/exports`, body);

    expect((await put(api, { source: sha256(drawing), format: 'stl', blob: stlHash })).status).toBe(422);
    expect((await put(api, { source: sha256('not in this project'), format: 'stl', blob: stlHash })).status).toBe(422);
    expect((await put(api, { source: sha256(part), format: 'stl', blob: sha256('never uploaded') })).status).toBe(422);
    expect((await put(api, { source: sha256(part), format: 'obj', blob: stlHash })).status).toBe(400);
    expect((await put(asViewer, { source: sha256(part), format: 'stl', blob: stlHash })).status).toBe(403);
    const outsider = client(harness, await createUser(harness, 'outsider'));
    expect((await outsider.post(`/v1/projects/${projectId}/exports/lookup`, { sha256s: [sha256(part)] })).status).toBe(404);
  });

  it('must look like the format they’re added as', async () => {
    const { projectId, part } = await project();
    const put = (format: string, blob: string) => api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format, blob });
    // A binary STL: an 80-byte header that needn't say "solid", a triangle count, and 50 bytes per triangle.
    const binary = Buffer.alloc(84 + 2 * 50);
    binary.write(`exported ${randomUUID()}`, 0);
    binary.writeUInt32LE(2, 80);
    const [stepHash, textStlHash, binaryHash, bomStepHash, truncatedHash] = (await upload(harness, api, projectId, [
      `ISO-10303-21;\nHEADER; ${randomUUID()}`,
      tetrahedron(),
      binary.toString('latin1'),
      `\uFEFF\r\n  ISO-10303-21; ${randomUUID()}`,
      binary.subarray(0, 120).toString('latin1'),
    ])) as [string, string, string, string, string];

    const wrong = await put('stl', stepHash);
    expect(wrong.status).toBe(422);
    expect(wrong.body.error).toMatchObject({ code: 'export_wrong_format', details: { format: 'stl' } });
    expect((await put('step', textStlHash)).body.error.code).toBe('export_wrong_format');
    expect((await put('stl', truncatedHash)).body.error.code).toBe('export_wrong_format');
    expect((await api.post(`/v1/projects/${projectId}/exports/lookup`, { sha256s: [sha256(part)] })).body.exports).toEqual({});

    expect((await put('stl', textStlHash)).status).toBe(200);
    expect((await put('stl', binaryHash)).status).toBe(200);
    expect((await put('step', stepHash)).status).toBe(200);
    expect((await put('step', bomStepHash)).status).toBe(200);
  });

  it('can be downloaded with a release, beside its files, leaving the plain download as it was', async () => {
    const created = await api.post('/v1/projects', { slug: `exports-${randomUUID().slice(0, 8)}`, name: 'Exports' });
    const projectId = created.body.id as string;
    const branch = await api.post(`/v1/projects/${projectId}/branches`, { name: 'work' });
    const [part, assembly, clip] = [`part ${randomUUID()}`, `assembly ${randomUUID()}`, `clip ${randomUUID()}`];
    await commitVersion(harness, api, projectId, branch.body.id, { 'Bracket.SLDPRT': part, 'Bracket.SLDASM': assembly, 'sub/Clip.SLDPRT': clip, 'Notes.txt': 'notes' });
    const [stl, step, assemblyStep, clipStl] = [tetrahedron(), `ISO-10303-21; part ${randomUUID()}`, `ISO-10303-21; assembly ${randomUUID()}`, tetrahedron()];
    const [stlHash, stepHash, assemblyHash, clipHash] = (await upload(harness, api, projectId, [stl, step, assemblyStep, clipStl])) as [string, string, string, string];
    for (const [source, format, blob] of [[part, 'stl', stlHash], [part, 'step', stepHash], [assembly, 'step', assemblyHash], [clip, 'stl', clipHash]] as const) {
      expect((await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(source), format, blob })).status).toBe(200);
    }
    const opened = await api.post(`/v1/branches/${branch.body.id}/release-requests`, { title: 'v1' });
    const requestId = opened.body.releaseRequest.id;
    const candidateManifestId = (await api.post(`/v1/release-requests/${requestId}/candidate`)).body.candidate.manifestId;
    await api.post(`/v1/release-requests/${requestId}/approvals`, { candidateManifestId });
    expect((await api.post(`/v1/release-requests/${requestId}/release`, { candidateManifestId })).status).toBe(201);
    const slug = created.body.slug as string;
    const archive = (query = '') => harness.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/releases/1/archive${query}`, headers: { authorization: `Bearer ${owner.token}` } });
    const before = await archive();

    // A STEP export replaced after the release doesn't change what the release was made with.
    const [laterStep] = (await upload(harness, api, projectId, [`ISO-10303-21; later ${randomUUID()}`])) as [string];
    expect((await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'step', blob: laterStep })).status).toBe(200);

    const plain = await archive();
    expect(plain.rawPayload.equals(before.rawPayload)).toBe(true);
    expect(Number(plain.headers['content-length'])).toBe(plain.rawPayload.length);

    const full = await archive('?exports=1');
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-disposition']).toContain(`${slug}-v1-with-exports.zip`);
    expect(Number(full.headers['content-length'])).toBe(full.rawPayload.length);
    const files = unzipSync(new Uint8Array(full.rawPayload));
    // A part and an assembly named alike keep their extensions, so their exports don't collide.
    expect(Object.keys(files).sort()).toEqual(
      [
        'Bracket.SLDASM',
        'Bracket.SLDPRT',
        'Notes.txt',
        'exports/Bracket.SLDASM.step',
        'exports/Bracket.SLDPRT.step',
        'exports/Bracket.SLDPRT.stl',
        'exports/sub/Clip.stl',
        'sub/Clip.SLDPRT',
      ].map((path) => `${slug}-v1/${path}`),
    );
    expect(Buffer.from(files[`${slug}-v1/exports/Bracket.SLDPRT.step`]!).toString()).toBe(step);
    expect(Buffer.from(files[`${slug}-v1/exports/sub/Clip.stl`]!).toString()).toBe(clipStl);
    expect((await archive('?exports=maybe')).statusCode).toBe(400);
  });

  it('go beside a release that has an exports folder of its own, so no path is in the zip twice', async () => {
    const created = await api.post('/v1/projects', { slug: `clash-${randomUUID().slice(0, 8)}`, name: 'Clash' });
    const projectId = created.body.id as string;
    const branch = await api.post(`/v1/projects/${projectId}/branches`, { name: 'work' });
    const part = `part ${randomUUID()}`;
    const committedStep = `ISO-10303-21; committed ${randomUUID()}`;
    await commitVersion(harness, api, projectId, branch.body.id, { 'Bracket.SLDPRT': part, 'Exports/Bracket.STEP': committedStep });
    const [stepHash] = (await upload(harness, api, projectId, [`ISO-10303-21; attached ${randomUUID()}`])) as [string];
    expect((await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'step', blob: stepHash })).status).toBe(200);
    const opened = await api.post(`/v1/branches/${branch.body.id}/release-requests`, { title: 'v1' });
    const requestId = opened.body.releaseRequest.id;
    const candidateManifestId = (await api.post(`/v1/release-requests/${requestId}/candidate`)).body.candidate.manifestId;
    await api.post(`/v1/release-requests/${requestId}/approvals`, { candidateManifestId });
    expect((await api.post(`/v1/release-requests/${requestId}/release`, { candidateManifestId })).status).toBe(201);

    const slug = created.body.slug as string;
    const full = await harness.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/releases/1/archive?exports=1`, headers: { authorization: `Bearer ${owner.token}` } });
    expect(Number(full.headers['content-length'])).toBe(full.rawPayload.length);
    const names = Object.keys(unzipSync(new Uint8Array(full.rawPayload)));
    expect(names.sort()).toEqual([`${slug}-v1-exports/Bracket.step`, `${slug}-v1/Bracket.SLDPRT`, `${slug}-v1/Exports/Bracket.STEP`]);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
  });

  it('come along when a release is forked', async () => {
    const { projectId, branchId, part } = await project('public');
    const [stlHash] = (await upload(harness, api, projectId, [tetrahedron()])) as [string];
    await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'stl', blob: stlHash });
    const opened = await api.post(`/v1/branches/${branchId}/release-requests`, { title: 'v1' });
    const requestId = opened.body.releaseRequest.id;
    const candidateManifestId = (await api.post(`/v1/release-requests/${requestId}/candidate`)).body.candidate.manifestId;
    await api.post(`/v1/release-requests/${requestId}/approvals`, { candidateManifestId });
    expect((await api.post(`/v1/release-requests/${requestId}/release`, { candidateManifestId })).status).toBe(201);

    const fork = await asViewer.post(`/v1/projects/${projectId}/forks`, { slug: `fork-${randomUUID().slice(0, 8)}`, name: 'Fork' });
    expect(fork.status).toBe(201);
    const lookup = await asViewer.post(`/v1/projects/${fork.body.id}/exports/lookup`, { sha256s: [sha256(part)] });
    expect(lookup.body.exports[sha256(part)]).toEqual([expect.objectContaining({ format: 'stl', sha256: stlHash })]);
    // The fork's v1 keeps them as its own release's exports, too.
    const kept = await asViewer.post(`/v1/projects/${fork.body.id}/exports/lookup`, { sha256s: [sha256(part)], releaseNumber: 1 });
    expect(kept.body.exports[sha256(part)]).toEqual([expect.objectContaining({ format: 'stl', sha256: stlHash })]);
    const [snapshot] = await harness.sql<{ count: number }[]>`
      select count(*)::int as count from release_exports x join releases r on r.id = x.release_id where r.project_id = ${fork.body.id} and r.number = 1
    `;
    expect(snapshot!.count).toBe(1);
  });

  it('come along from a release made before its exports were snapshotted', async () => {
    const { projectId, branchId, part } = await project('public');
    const [stlHash] = (await upload(harness, api, projectId, [tetrahedron()])) as [string];
    await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'stl', blob: stlHash });
    await releaseV1(projectId, branchId);
    // As if the release came from the API before snapshots, and the job hasn't caught up yet. (Releases are
    // locked; only the purge setting lets these rows go.)
    await harness.sql.begin(async (tx) => {
      await tx`select set_config('gigacad.purge', 'on', true)`;
      await tx`delete from release_exports where release_id in (select id from releases where project_id = ${projectId})`;
      await tx`delete from release_export_snapshots where release_id in (select id from releases where project_id = ${projectId})`;
    });

    const fork = await asViewer.post(`/v1/projects/${projectId}/forks`, { slug: `fork-${randomUUID().slice(0, 8)}`, name: 'Fork' });
    expect(fork.status).toBe(201);
    const kept = await asViewer.post(`/v1/projects/${fork.body.id}/exports/lookup`, { sha256s: [sha256(part)], releaseNumber: 1 });
    expect(kept.body.exports[sha256(part)]).toEqual([expect.objectContaining({ format: 'stl', sha256: stlHash })]);
  });

  it('refuse an approval or release that saw an older export, when the reviewer says which they saw', async () => {
    const { projectId, branchId, part } = await project();
    const [first, second] = (await upload(harness, api, projectId, [tetrahedron(), tetrahedron()])) as [string, string];
    await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'stl', blob: first });
    const opened = await api.post(`/v1/branches/${branchId}/release-requests`, { title: 'Swap' });
    const requestId = opened.body.releaseRequest.id as string;
    const candidateManifestId = (await api.post(`/v1/release-requests/${requestId}/candidate`)).body.candidate.manifestId;
    const seen = (await api.get(`/v1/release-requests/${requestId}`)).body.approvals.exportsChangedAt as string;
    expect(seen).toEqual(expect.any(String));

    // The STL is swapped after the page loaded and before Approve is pressed.
    await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'stl', blob: second });
    const stale = await api.post(`/v1/release-requests/${requestId}/approvals`, { candidateManifestId, exportsChangedAt: seen });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_candidate');
    expect((await api.post(`/v1/release-requests/${requestId}/release`, { candidateManifestId, exportsChangedAt: seen })).body.error.code).toBe('stale_candidate');

    // Reviewing again gives the new version, which approves and releases.
    const current = (await api.get(`/v1/release-requests/${requestId}`)).body.approvals.exportsChangedAt as string;
    expect((await api.post(`/v1/release-requests/${requestId}/approvals`, { candidateManifestId, exportsChangedAt: current })).status).toBe(200);
    expect((await api.post(`/v1/release-requests/${requestId}/release`, { candidateManifestId, exportsChangedAt: current })).status).toBe(201);
  });

  it('make an approval wait for an export swap in progress, and then refuse it as stale', async () => {
    const { projectId, branchId, part } = await project();
    const [first, second] = (await upload(harness, api, projectId, [tetrahedron(), tetrahedron()])) as [string, string];
    await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'stl', blob: first });
    const opened = await api.post(`/v1/branches/${branchId}/release-requests`, { title: 'Race' });
    const requestId = opened.body.releaseRequest.id as string;
    const candidateManifestId = (await api.post(`/v1/release-requests/${requestId}/candidate`)).body.candidate.manifestId;
    const seen = (await api.get(`/v1/release-requests/${requestId}`)).body.approvals.exportsChangedAt as string;

    // An export swap holds the project lock and has written its row, but hasn't committed.
    let commit!: () => void;
    let written!: () => void;
    const until = new Promise<void>((resolve) => (commit = resolve));
    const ready = new Promise<void>((resolve) => (written = resolve));
    const swap = harness.sql.begin(async (tx) => {
      await tx`select 1 from projects where id = ${projectId} for update`;
      await tx`
        update file_exports set blob_sha256 = ${second}, created_at = clock_timestamp()
        where project_id = ${projectId} and source_sha256 = ${sha256(part)} and format = 'stl'
      `;
      written();
      await until;
    });
    await ready;
    const approving = api.post(`/v1/release-requests/${requestId}/approvals`, { candidateManifestId, exportsChangedAt: seen });
    // The approval can't get past the lock while the swap is open.
    const early = await Promise.race([approving.then(() => 'answered'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 500))]);
    expect(early).toBe('waiting');
    commit();
    await swap;
    const approved = await approving;
    expect(approved.status).toBe(409);
    expect(approved.body.error.code).toBe('stale_candidate');
  });

  it('still approve for installed clients that send no exports version', async () => {
    const { projectId, branchId, part } = await project();
    const [stl] = (await upload(harness, api, projectId, [tetrahedron()])) as [string];
    await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'stl', blob: stl });
    const opened = await api.post(`/v1/branches/${branchId}/release-requests`, { title: 'Old client' });
    const requestId = opened.body.releaseRequest.id as string;
    const candidateManifestId = (await api.post(`/v1/release-requests/${requestId}/candidate`)).body.candidate.manifestId;
    expect((await api.post(`/v1/release-requests/${requestId}/approvals`, { candidateManifestId })).status).toBe(200);
    expect((await api.post(`/v1/release-requests/${requestId}/approvals`, {})).status).toBe(200);
  });

  it('keep approvals when the same export is attached again, and count a re-approval after a change as new', async () => {
    const { projectId, branchId, part } = await project();
    const [first, second] = (await upload(harness, api, projectId, [tetrahedron(), tetrahedron()])) as [string, string];
    const attach = (blob: string) => api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'stl', blob });
    await attach(first);
    const opened = await api.post(`/v1/branches/${branchId}/release-requests`, { title: 'Exports' });
    const requestId = opened.body.releaseRequest.id as string;
    const candidateManifestId = (await api.post(`/v1/release-requests/${requestId}/candidate`)).body.candidate.manifestId;
    await api.post(`/v1/release-requests/${requestId}/approvals`, { candidateManifestId });
    const counted = async () => (await api.get(`/v1/release-requests/${requestId}`)).body.approvals.evaluation.countedUserIds as string[];
    const approvedEvents = async () =>
      ((await api.get(`/v1/projects/${projectId}/events?order=desc&limit=50`)).body as { kind: string }[]).filter((event) => event.kind === 'release_request_approved').length;
    expect(await counted()).toEqual([owner.id]);

    // The same bytes again change nothing, so the approval still counts.
    await attach(first);
    expect(await counted()).toEqual([owner.id]);
    // A different export voids it; approving again is recorded like a first approval.
    await attach(second);
    expect(await counted()).toEqual([]);
    expect(await approvedEvents()).toBe(1);
    await api.post(`/v1/release-requests/${requestId}/approvals`, { candidateManifestId });
    expect(await counted()).toEqual([owner.id]);
    expect(await approvedEvents()).toBe(2);
  });

  it('only change the thumbnail in their own project, even when another project holds the same file', async () => {
    const { projectId, part } = await project('public');
    const [ownStl, otherStl] = [tetrahedron(), tetrahedron()];
    const [ownHash] = (await upload(harness, api, projectId, [ownStl])) as [string];
    await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'stl', blob: ownHash });
    await render();
    expect(await shown(api, projectId, part)).toContain(thumbnailKey(ownHash));

    // An outsider puts the same part bytes in a project of their own and gives it another STL.
    const outsider = await createUser(harness, 'copier');
    const asOutsider = client(harness, outsider);
    const theirs = (await asOutsider.post('/v1/projects', { slug: `copy-${randomUUID().slice(0, 8)}`, name: 'Copy' })).body.id as string;
    const branch = await asOutsider.post(`/v1/projects/${theirs}/branches`, { name: 'work' });
    await commitVersion(harness, asOutsider, theirs, branch.body.id, { 'Bracket.SLDPRT': part });
    const [otherHash] = (await upload(harness, asOutsider, theirs, [otherStl])) as [string];
    expect((await asOutsider.put(`/v1/projects/${theirs}/exports`, { source: sha256(part), format: 'stl', blob: otherHash })).status).toBe(200);
    await render();

    expect(await shown(asOutsider, theirs, part)).toContain(thumbnailKey(otherHash));
    expect(await shown(api, projectId, part)).toContain(thumbnailKey(ownHash));
    expect(await shown(client(harness, null), projectId, part)).toContain(thumbnailKey(ownHash));
    const [cover] = await harness.sql<{ sha: string | null }[]>`select project_thumbnail(${projectId}) as sha`;
    expect(cover?.sha).toBe(ownHash);
  });

  it('drawn onto a shared row by an older API are put back to the file’s own preview', async () => {
    const { projectId, part } = await project();
    const [stlHash] = (await upload(harness, api, projectId, [tetrahedron()])) as [string];
    // What main's setFileExport and thumbnail job did before migration 20261016093000.
    await harness.sql`update thumbnails set model_sha256 = ${stlHash}, model_format = 'stl', status = 'ready' where blob_sha256 = ${sha256(part)}`;
    expect(await resetExportDrawnThumbnails(harness.sql)).toBeGreaterThan(0);
    const [row] = await harness.sql<{ status: string; modelSha256: string | null }[]>`select status, model_sha256 from thumbnails where blob_sha256 = ${sha256(part)}`;
    expect(row).toEqual({ status: 'pending', modelSha256: null });
  });
});
