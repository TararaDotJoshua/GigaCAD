import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clearAbandonedUploads,
  deleteOrphanBlobs,
  notifyStaleCheckouts,
  purgeDeletedProjects,
  runJobs,
  unlinkUnusedBlobs,
} from '../src/jobs.js';
import type { Mailer } from '../src/mail.js';
import { blobKey, stagingKey } from '../src/storage.js';
import { client, commitVersion, createHarness, createUser, MACHINE, sha256, upload, type Client, type Harness, type TestUser } from './helpers.js';

let harness: Harness;
let owner: TestUser;
let api: Client;
const now = { graceHours: 0 };

beforeAll(async () => {
  harness = await createHarness();
  owner = await createUser(harness, 'keeper');
  api = client(harness, owner);
});

afterAll(async () => {
  await harness?.close();
});

async function newProject() {
  const response = await api.post('/v1/projects', { slug: `jobs-${randomUUID().slice(0, 8)}`, name: 'Jobs' });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function newBranch(projectId: string, name = 'work') {
  const response = await api.post(`/v1/projects/${projectId}/branches`, { name });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

const unique = (label: string) => `${label} ${randomUUID()}`;
const stored = (content: string) => harness.storage.objects.has(blobKey(sha256(content)));
const used = async () => (await api.get('/v1/me/billing')).body.usedBytes as number;

describe('storage cleanup', () => {
  it('stops counting and storing autosaves once a version prunes them', async () => {
    const projectId = await newProject();
    const branchId = await newBranch(projectId);
    const [draft, final] = [unique('draft'), unique('final')];

    const checkout = await api.post(`/v1/branches/${branchId}/checkout`, { machine: MACHINE });
    const [draftHash] = await upload(harness, api, projectId, [draft]);
    const autosave = await api.post(`/v1/branches/${branchId}/commits`, {
      parentId: checkout.body.headCommitId,
      machine: MACHINE,
      kind: 'autosave',
      files: [{ path: 'Part.SLDPRT', blob: draftHash }],
    });
    expect(autosave.status).toBe(201);
    await commitVersion(harness, api, projectId, branchId, { 'Part.SLDPRT': final });
    const before = await used();

    expect(await unlinkUnusedBlobs(harness.sql, now)).toBeGreaterThanOrEqual(1);
    expect(await used()).toBe(before - Buffer.byteLength(draft));
    expect(await deleteOrphanBlobs(harness.sql, harness.storage, now)).toBeGreaterThanOrEqual(1);
    expect(stored(draft)).toBe(false);
    expect(stored(final)).toBe(true);
    const [row] = await harness.sql`select 1 from blobs where sha256 = ${sha256(draft)}`;
    expect(row).toBeUndefined();
  });

  it('keeps recent uploads that are not committed yet, and files other projects still use', async () => {
    const [first, second] = [await newProject(), await newProject()];
    const shared = unique('shared');
    await upload(harness, api, first, [shared]);
    await upload(harness, api, second, [shared]);
    const branchId = await newBranch(second);
    await commitVersion(harness, api, second, branchId, { 'Shared.SLDPRT': shared });

    // Within the grace period nothing is unlinked.
    await unlinkUnusedBlobs(harness.sql, { graceHours: 24 });
    const [waiting] = await harness.sql`select 1 from project_blobs where project_id = ${first} and sha256 = ${sha256(shared)}`;
    expect(waiting).toBeDefined();

    // After it, the unused link goes, but the file stays for the project that uses it.
    await unlinkUnusedBlobs(harness.sql, now);
    await deleteOrphanBlobs(harness.sql, harness.storage, now);
    const links = await harness.sql`select project_id from project_blobs where sha256 = ${sha256(shared)}`;
    expect(links.map((link) => link.projectId)).toEqual([second]);
    expect(stored(shared)).toBe(true);
  });

  it('clears uploads that were started and never completed', async () => {
    const projectId = await newProject();
    const content = unique('abandoned');
    const plan = await api.post(`/v1/projects/${projectId}/blobs/uploads`, { blobs: [{ sha256: sha256(content), size: Buffer.byteLength(content) }] });
    const upload = plan.body.uploads[0];
    harness.storage.put(upload.url, content);

    expect(await clearAbandonedUploads(harness.sql, harness.storage, { graceHours: 24 })).toBe(0);
    expect(await clearAbandonedUploads(harness.sql, harness.storage, now)).toBeGreaterThanOrEqual(1);
    expect(harness.storage.objects.has(stagingKey(upload.uploadId))).toBe(false);
    const [row] = await harness.sql`select 1 from blob_uploads where id = ${upload.uploadId}`;
    expect(row).toBeUndefined();
  });
});

describe('purging deleted projects', () => {
  it('removes a project deleted over 30 days ago, releases included, and then its files', async () => {
    const projectId = await newProject();
    const branchId = await newBranch(projectId);
    const content = unique('released');
    await commitVersion(harness, api, projectId, branchId, { 'Robot.SLDASM': content });
    const opened = await api.post(`/v1/branches/${branchId}/release-requests`, { title: 'v1' });
    const requestId = opened.body.releaseRequest.id;
    await api.post(`/v1/release-requests/${requestId}/candidate`);
    await api.post(`/v1/release-requests/${requestId}/approvals`);
    expect((await api.post(`/v1/release-requests/${requestId}/release`)).status).toBe(201);

    // A project deleted only yesterday must survive.
    const recent = await newProject();
    expect((await api.delete(`/v1/projects/${recent}`)).status).toBe(204);
    expect((await api.delete(`/v1/projects/${projectId}`)).status).toBe(204);
    await harness.sql`update projects set deleted_at = now() - interval '31 days' where id = ${projectId}`;

    expect(await purgeDeletedProjects(harness.sql)).toBeGreaterThanOrEqual(1);
    const [gone] = await harness.sql`select 1 from projects where id = ${projectId}`;
    expect(gone).toBeUndefined();
    const [kept] = await harness.sql`select 1 from projects where id = ${recent}`;
    expect(kept).toBeDefined();
    const releases = await harness.sql`select 1 from releases where project_id = ${projectId}`;
    expect(releases).toHaveLength(0);

    await deleteOrphanBlobs(harness.sql, harness.storage, now);
    expect(stored(content)).toBe(false);
  });

  it('still refuses to delete a release outside a purge', async () => {
    const [release] = await harness.sql`select id from releases limit 1`;
    if (!release) return;
    await expect(harness.sql`delete from releases where id = ${release.id}`).rejects.toThrow(/permanently locked/);
  });
});

describe('stale checkout notices', () => {
  it('reminds the holder once per checkout', async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const mailer: Mailer = { send: async (message) => void sent.push(message) };
    const projectId = await newProject();
    const branchId = await newBranch(projectId, `stale-${randomUUID().slice(0, 6)}`);
    await commitVersion(harness, api, projectId, branchId, { 'A.SLDPRT': unique('a') }, { checkIn: false });
    await harness.sql`update branches set checked_out_at = now() - interval '8 days' where id = ${branchId}`;
    await harness.sql`update commits set created_at = now() - interval '8 days' where branch_id = ${branchId}`;

    await notifyStaleCheckouts(harness.sql, mailer, 'https://app.example');
    const mine = sent.filter((message) => message.text.includes(branchId) || message.subject.includes('stale-'));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to).toMatch(/@test\.gigacad\.site$/);
    expect(mine[0]!.text).toContain('8 days ago');
    expect(mine[0]!.text).toContain(`https://app.example/${owner.handle}/`);

    await notifyStaleCheckouts(harness.sql, mailer, 'https://app.example');
    expect(sent.filter((message) => message.subject.includes('stale-'))).toHaveLength(1);
  });

  it('skips checkouts with recent commits', async () => {
    const sent: unknown[] = [];
    const projectId = await newProject();
    const branchId = await newBranch(projectId, `busy-${randomUUID().slice(0, 6)}`);
    await commitVersion(harness, api, projectId, branchId, { 'B.SLDPRT': unique('b') }, { checkIn: false });
    await harness.sql`update branches set checked_out_at = now() - interval '8 days' where id = ${branchId}`;
    await notifyStaleCheckouts(harness.sql, { send: async (message) => void sent.push(message) }, 'https://app.example');
    expect(sent.filter((message) => JSON.stringify(message).includes('busy-'))).toHaveLength(0);
  });
});

describe('runJobs', () => {
  it('runs every job once and reports what it did', async () => {
    const report = await runJobs({ sql: harness.sql, storage: harness.storage, webOrigin: 'https://app.example' });
    expect(report).toMatchObject({ purgedProjects: expect.any(Number), unlinkedBlobs: expect.any(Number), staleNotices: 0 });
  });
});
