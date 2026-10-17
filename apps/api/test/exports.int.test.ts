import { randomUUID } from 'node:crypto';
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
