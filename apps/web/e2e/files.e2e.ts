import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

// Root files, folders, and their edge states. Defaults match `supabase start` and the API's local port.
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:8787';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');

async function api<T = any>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(API_URL + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function uploadContents(token: string, projectId: string, contents: readonly string[]) {
  const blobs = contents.map((content) => ({ sha256: sha256(content), size: Buffer.byteLength(content) }));
  const plan = await api(token, 'POST', `/v1/projects/${projectId}/blobs/uploads`, { blobs });
  for (const upload of plan.uploads) {
    const content = contents[blobs.findIndex((blob) => blob.sha256 === upload.sha256)]!;
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: content });
    if (!put.ok) throw new Error(`upload failed: ${put.status} ${await put.text()}`);
  }
  if (plan.uploads.length > 0) await api(token, 'POST', `/v1/projects/${projectId}/blobs/complete`, { uploadIds: plan.uploads.map((upload: { uploadId: string }) => upload.uploadId) });
}

/** Adds a root file through the API, as the browser uploader does. */
async function addFile(token: string, projectId: string, parentId: string | null, name: string, content: string) {
  await uploadContents(token, projectId, [content]);
  return api<{ id: string }>(token, 'POST', `/v1/projects/${projectId}/directory/files`, { parentId, name, blob: sha256(content) });
}

async function release(token: string, projectId: string, files: Record<string, string>) {
  const branch = await api(token, 'POST', `/v1/projects/${projectId}/branches`, { name: `cut-${randomUUID().slice(0, 4)}` });
  const checkout = await api(token, 'POST', `/v1/branches/${branch.id}/checkout`, { machine: 'e2e' });
  await uploadContents(token, projectId, Object.values(files));
  await api(token, 'POST', `/v1/branches/${branch.id}/commits`, {
    parentId: checkout.headCommitId,
    machine: 'e2e',
    kind: 'version',
    message: 'e2e',
    files: Object.entries(files).map(([path, content]) => ({ path, blob: sha256(content) })),
  });
  await api(token, 'POST', `/v1/branches/${branch.id}/checkin`);
  const request = await api(token, 'POST', `/v1/branches/${branch.id}/release-requests`, { title: 'First cut' });
  await api(token, 'POST', `/v1/release-requests/${request.releaseRequest.id}/candidate`);
  await api(token, 'POST', `/v1/release-requests/${request.releaseRequest.id}/approvals`);
  await api(token, 'POST', `/v1/release-requests/${request.releaseRequest.id}/release`);
}

interface World {
  email: string;
  password: string;
  token: string;
  handle: string;
  slug: string;
  projectId: string;
  docsId: string;
  publicSlug: string;
}

let world: World;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const email = `e2e-files-${randomUUID().slice(0, 8)}@test.gigacad.site`;
  const password = `pw-${randomUUID()}`;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const signedIn = await createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const token = signedIn.data.session.access_token;
  const handle = `e2e-files-${randomUUID().slice(0, 6)}`;
  await api(token, 'PATCH', '/v1/me', { handle });

  const slug = 'shop';
  const project = await api(token, 'POST', '/v1/projects', { slug, name: 'Shop', visibility: 'private' });
  const docs = await api(token, 'POST', `/v1/projects/${project.id}/directory/folders`, { parentId: null, name: 'Docs' });
  const notes = await addFile(token, project.id, docs.id, 'notes.txt', `notes ${randomUUID()}`);
  const second = `notes rev 2 ${randomUUID()}`;
  await uploadContents(token, project.id, [second]);
  await api(token, 'POST', `/v1/projects/${project.id}/directory/entries/${notes.id}/revisions`, { blob: sha256(second) });
  await api(token, 'POST', `/v1/projects/${project.id}/directory/folders`, { parentId: null, name: 'a%2Fb' });
  await addFile(
    token,
    project.id,
    null,
    'README.md',
    '# Shop\n\nRead the [notes](Docs/notes.txt) first. The [released leg](Releases/v1/parts/Leg.SLDPRT) is final.\n\n![Bench](photos/missing.png)\n\n![Top](Releases/v1/renders/top.png)\n',
  );
  await api(token, 'POST', `/v1/projects/${project.id}/tags`, { name: 'Laser cut' });
  await release(token, project.id, { 'Bench.SLDASM': 'bench', 'parts/Leg.SLDPRT': `leg ${'x'.repeat(400)}`, 'parts/Top.SLDPRT': 'top', 'renders/top.png': `png ${randomUUID()}` });
  // An open branch from v1 holds the same files, so search's best place for them is the branch, not v1.
  await api(token, 'POST', `/v1/projects/${project.id}/branches`, { name: 'next', fromRelease: 1 });

  const publicSlug = 'open-bench';
  const open = await api(token, 'POST', '/v1/projects', { slug: publicSlug, name: 'Open bench', visibility: 'public' });
  await addFile(token, open.id, null, 'cut-list.csv', 'part,qty\nleg,4\n');

  world = { email, password, token, handle, slug, projectId: project.id, docsId: docs.id, publicSlug };
});

async function logIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(world.email);
  await page.getByLabel('Password', { exact: true }).fill(world.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/app');
}

const projectUrl = (...rest: (string | number)[]) => ['', world.handle, world.slug, ...rest].join('/');

test('opens the file menu from the keyboard and says what a delete takes', async ({ page }) => {
  await logIn(page);
  await page.goto(projectUrl());
  const more = page.getByRole('button', { name: 'More actions for Docs' });
  // Retried, in case the first press lands before the page has hydrated.
  await expect(async () => {
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Open' })).toBeFocused({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Rename…' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Delete…' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'Delete Docs' })).toContainText('Deletes 1 file, with 2 revisions.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(more).toBeFocused();
});

test('README links open project files in place, and missing images say so', async ({ page }) => {
  await logIn(page);
  await page.goto(projectUrl());
  const readme = page.getByRole('region', { name: 'README.md' });
  await expect(readme.getByText('Missing image: photos/missing.png')).toBeVisible();
  // Paths into a release resolve there, though the same files are also on an open branch.
  await expect(readme.getByRole('img', { name: 'Top' })).toHaveAttribute('src', /\/media\//);
  await expect(readme.getByText(/Missing image: Releases/)).toHaveCount(0);
  await expect(readme.getByRole('link', { name: 'released leg' })).toHaveAttribute('href', projectUrl('tree', 'Releases', 'v1', 'parts'));
  const link = readme.getByRole('link', { name: 'notes', exact: true });
  await expect(link).not.toHaveAttribute('target', '_blank');
  await link.click();
  await page.waitForURL('**/entries/**');
  await expect(page.getByRole('heading', { name: 'notes.txt' })).toBeVisible();
  // The file's own page shows what's in it, and its older revision can become current again.
  await expect(page.getByRole('region', { name: 'Contents of notes.txt' })).toContainText('notes rev 2');
  await expect(page.getByRole('button', { name: 'Make current' })).toBeVisible();
});

test('sorting a release’s files stays on the release page', async ({ page }) => {
  await logIn(page);
  await page.goto(projectUrl('releases', 1));
  await page.getByRole('columnheader', { name: 'Size' }).getByRole('link').click();
  await page.waitForURL(`**${projectUrl('releases', 1)}?sort=size`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('v1');
});

test('a page past the end of a folder goes back to its last page', async ({ page }) => {
  await logIn(page);
  await page.goto(`${projectUrl('tree', 'Docs')}?offset=500`);
  await page.waitForURL(`**${projectUrl('tree', 'Docs')}`);
  await expect(page.getByRole('row', { name: /notes\.txt/ })).toBeVisible();
});

test('a folder named with a percent escape keeps its name in the tab title', async ({ page }) => {
  await logIn(page);
  await page.goto(projectUrl('tree', encodeURIComponent('a%2Fb')));
  await expect(page).toHaveTitle(/^a%2Fb · /);
});

test('mixed-case addresses go to their lowercase spelling', async ({ request }) => {
  const response = await request.get(`/${world.handle.toUpperCase()}/${world.slug.toUpperCase()}/tree/Docs`, { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new URL(response.headers().location!, 'http://x').pathname).toBe(projectUrl('tree', 'Docs'));
});

test('a deleted file’s page says it was deleted and where it was', async ({ page }) => {
  const doomed = await addFile(world.token, world.projectId, world.docsId, 'old-notes.txt', `old ${randomUUID()}`);
  await api(world.token, 'DELETE', `/v1/projects/${world.projectId}/directory/entries/${doomed.id}`);
  await logIn(page);
  await page.goto(projectUrl('entries', doomed.id));
  await expect(page.getByRole('heading', { name: 'This file was deleted' })).toBeVisible();
  await page.getByRole('link', { name: 'Open Docs' }).click();
  await page.waitForURL(`**${projectUrl('tree', 'Docs')}`);
});

test('files dropped during an upload wait their turn, empty files included', async ({ page }) => {
  await logIn(page);
  await page.goto(projectUrl('tree', 'Docs'));
  const drop = async (files: [string, string][]) => {
    const transfer = await page.evaluateHandle((files) => {
      const transfer = new DataTransfer();
      for (const [name, body] of files) transfer.items.add(new File([body], name));
      return transfer;
    }, files);
    await page.dispatchEvent('.drop-zone', 'dragover', { dataTransfer: transfer });
    await page.dispatchEvent('.drop-zone', 'drop', { dataTransfer: transfer });
  };
  await expect(page.getByRole('button', { name: 'Upload files' })).toBeEnabled();
  await drop([
    ['big.txt', `big ${randomUUID()} ${'x'.repeat(300_000)}`],
    ['empty.SLDPRT', ''],
  ]);
  await drop([['later.txt', `later ${randomUUID()}`]]);
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded 3 files.' })).toBeVisible();
  for (const name of ['big.txt', 'empty.SLDPRT', 'later.txt']) await expect(page.getByRole('row', { name: new RegExp(name.replace('.', '\\.')) })).toBeVisible();
});

test('closing the tag picker forgets ticks that weren’t saved', async ({ page }) => {
  await logIn(page);
  await page.goto(projectUrl('tree', 'Docs'));
  const row = page.getByRole('row', { name: /notes\.txt/ }).first();
  const picker = row.getByLabel('Tags for notes.txt');
  await picker.click();
  await row.getByLabel('Laser cut').check();
  await page.keyboard.press('Escape');
  await expect(row.getByLabel('Laser cut')).toBeHidden();
  await picker.click();
  await expect(row.getByLabel('Laser cut')).not.toBeChecked();
});

test('replacing a file with the same contents says nothing changed', async ({ page }) => {
  const content = `same ${randomUUID()}`;
  const entry = await addFile(world.token, world.projectId, null, 'same.txt', content);
  await logIn(page);
  await page.goto(projectUrl('entries', entry.id));
  await page.locator('input[type="file"]').setInputFiles({ name: 'same.txt', mimeType: 'text/plain', buffer: Buffer.from(content) });
  await expect(page.getByText('No changes: this is already revision 1.')).toBeVisible();
  // A file of another type asks first.
  await page.locator('input[type="file"]').setInputFiles({ name: 'same.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('other') });
  await expect(page.getByRole('group', { name: 'Confirm the replacement' })).toContainText('It’s a different type of file.');
});

test('a move that empties a folder still says where the file went', async ({ page }) => {
  const solo = await api(world.token, 'POST', `/v1/projects/${world.projectId}/directory/folders`, { parentId: null, name: `Solo ${randomUUID().slice(0, 4)}` });
  const name = `solo-${randomUUID().slice(0, 6)}.txt`;
  await addFile(world.token, world.projectId, solo.id, name, `solo ${randomUUID()}`);
  await logIn(page);
  await page.goto(projectUrl('tree', solo.name));
  await expect(async () => {
    await page.getByRole('button', { name: `More actions for ${name}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Move to…' })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  await page.getByRole('menuitem', { name: 'Project root' }).click();
  await expect(page.getByText('This folder is empty.')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: `Moved ${name} to` })).toBeVisible();
});

test('deleting a file from its page says so in its folder, and a made-up link says nothing', async ({ page }) => {
  const name = `gone-${randomUUID().slice(0, 6)}.txt`;
  const entry = await addFile(world.token, world.projectId, world.docsId, name, `gone ${randomUUID()}`);
  await logIn(page);
  await page.goto(projectUrl('entries', entry.id));
  await page.getByRole('button', { name: 'Delete file' }).click();
  await page.getByRole('button', { name: 'Delete file' }).click();
  await page.waitForURL(`**${projectUrl('tree', 'Docs')}?deleted=${entry.id}`);
  await expect(page.getByRole('status').filter({ hasText: `Deleted Docs/${name}.` })).toBeVisible();
  await page.goto(`${projectUrl('tree', 'Docs')}?deleted=${randomUUID()}`);
  await expect(page.getByText(/^Deleted /)).toHaveCount(0);
});

test('a long project name wraps instead of widening a phone screen', async ({ browser }) => {
  const name = 'Gearbox'.repeat(14);
  const slug = `long-${randomUUID().slice(0, 6)}`;
  await api(world.token, 'POST', '/v1/projects', { slug, name, description: 'x'.repeat(2000), visibility: 'public' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const phone = await context.newPage();
  await phone.goto('/login');
  await phone.getByLabel('Email', { exact: true }).fill(world.email);
  await phone.getByLabel('Password', { exact: true }).fill(world.password);
  await phone.getByRole('button', { name: 'Log in' }).click();
  await phone.waitForURL('**/app');
  for (const path of ['/app', `/${world.handle}/${slug}`, `/${world.handle}`, '/explore']) {
    await phone.goto(path);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
  }
  await context.close();
});

test('signed-out visitors download a public project’s files without logging in', async ({ browser }) => {
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/${world.handle}/${world.publicSlug}`);
  const [download] = await Promise.all([visitor.waitForEvent('download'), visitor.getByRole('button', { name: 'Download cut-list.csv' }).click()]);
  expect(download.suggestedFilename()).toBe('cut-list.csv');
  expect(visitor.url()).not.toContain('/login');
  await visitor.context().close();
});
