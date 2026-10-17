import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unlinkUnusedBlobs } from '../src/jobs.js';
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
  (await harness.sql<{ status: string; error: string | null; modelFormat: string | null }[]>`
    select status, error, model_format from thumbnails where blob_sha256 = ${sha256(content)}
  `)[0];
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
    expect(await thumbnail(part)).toMatchObject({ status: 'pending', modelFormat: 'stl' });
    // Open pages refresh on project events, so they show the new export.
    const [event] = (await asViewer.get(`/v1/projects/${projectId}/events?order=desc&limit=1`)).body;
    expect(event).toMatchObject({ kind: 'file_export_attached', actorId: owner.id, payload: { source: sha256(part), format: 'stl', blob: stlHash } });

    await render();
    expect(await thumbnail(part)).toMatchObject({ status: 'ready', error: null });
    expect(harness.storage.objects.get(thumbnailKey(sha256(part)))?.subarray(1, 4).toString()).toBe('PNG');

    const lookup = await asViewer.post(`/v1/projects/${projectId}/exports/lookup`, { sha256s: [sha256(part)] });
    expect(lookup.body).toEqual({ exports: { [sha256(part)]: [{ format: 'stl', sha256: stlHash, size: Buffer.byteLength(stl) }] } });
    const download = await asViewer.post(`/v1/projects/${projectId}/blobs/downloads`, { sha256s: [stlHash], filenames: { [stlHash]: 'Bracket.stl' } });
    expect(download.body.downloads).toHaveLength(1);

    // A STEP added later doesn't take over from the STL for the thumbnail.
    const [stepHash] = (await upload(harness, api, projectId, [`ISO-10303-21; ${randomUUID()}`])) as [string];
    expect((await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'step', blob: stepHash })).status).toBe(200);
    expect(await thumbnail(part)).toMatchObject({ status: 'ready', modelFormat: 'stl' });
    const both = await api.post(`/v1/projects/${projectId}/exports/lookup`, { sha256s: [sha256(part)] });
    expect(both.body.exports[sha256(part)].map((entry: { format: string }) => entry.format)).toEqual(['step', 'stl']);

    // Exports stay stored while their source file does.
    await unlinkUnusedBlobs(harness.sql, { graceHours: 0 });
    const [kept] = await harness.sql`select 1 from project_blobs where project_id = ${projectId} and sha256 = ${stlHash}`;
    expect(kept).toBeDefined();
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
    const opened = await api.post(`/v1/branches/${branch.body.id}/release-requests`, { title: 'v1' });
    const requestId = opened.body.releaseRequest.id;
    await api.post(`/v1/release-requests/${requestId}/candidate`);
    await api.post(`/v1/release-requests/${requestId}/approvals`);
    expect((await api.post(`/v1/release-requests/${requestId}/release`)).status).toBe(201);
    const slug = created.body.slug as string;
    const archive = (query = '') => harness.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/releases/1/archive${query}`, headers: { authorization: `Bearer ${owner.token}` } });
    const before = await archive();

    const [stl, step, assemblyStep, clipStl] = [tetrahedron(), `ISO-10303-21; part ${randomUUID()}`, `ISO-10303-21; assembly ${randomUUID()}`, tetrahedron()];
    const [stlHash, stepHash, assemblyHash, clipHash] = (await upload(harness, api, projectId, [stl, step, assemblyStep, clipStl])) as [string, string, string, string];
    for (const [source, format, blob] of [[part, 'stl', stlHash], [part, 'step', stepHash], [assembly, 'step', assemblyHash], [clip, 'stl', clipHash]] as const) {
      expect((await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(source), format, blob })).status).toBe(200);
    }

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

  it('come along when a release is forked', async () => {
    const { projectId, branchId, part } = await project('public');
    const [stlHash] = (await upload(harness, api, projectId, [tetrahedron()])) as [string];
    await api.put(`/v1/projects/${projectId}/exports`, { source: sha256(part), format: 'stl', blob: stlHash });
    const opened = await api.post(`/v1/branches/${branchId}/release-requests`, { title: 'v1' });
    const requestId = opened.body.releaseRequest.id;
    await api.post(`/v1/release-requests/${requestId}/candidate`);
    await api.post(`/v1/release-requests/${requestId}/approvals`);
    expect((await api.post(`/v1/release-requests/${requestId}/release`)).status).toBe(201);

    const fork = await asViewer.post(`/v1/projects/${projectId}/forks`, { slug: `fork-${randomUUID().slice(0, 8)}`, name: 'Fork' });
    expect(fork.status).toBe(201);
    const lookup = await asViewer.post(`/v1/projects/${fork.body.id}/exports/lookup`, { sha256s: [sha256(part)] });
    expect(lookup.body.exports[sha256(part)]).toEqual([expect.objectContaining({ format: 'stl', sha256: stlHash })]);
  });
});
