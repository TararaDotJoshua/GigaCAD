import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

// Forms that fail safely, feedback that outlives its button, and the team's "Needs you".
// Defaults match `supabase start` and the API's local port; override with env vars.
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

interface Person {
  email: string;
  password: string;
  token: string;
  handle: string;
}

async function createPerson(prefix: string): Promise<Person> {
  const email = `e2e-${prefix}-${randomUUID().slice(0, 8)}@test.gigacad.site`;
  const password = `pw-${randomUUID()}`;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const signedIn = await createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const token = signedIn.data.session.access_token;
  const handle = `e2e-${prefix}-${randomUUID().slice(0, 6)}`;
  await api(token, 'PATCH', '/v1/me', { handle });
  return { email, password, token, handle };
}

/** Uploads contents, then checks out, commits a version, and checks in, like the CLI does. */
async function commitVersion(token: string, projectId: string, branchId: string, files: Record<string, string>) {
  const checkout = await api(token, 'POST', `/v1/branches/${branchId}/checkout`, { machine: 'e2e' });
  const contents = Object.values(files);
  const blobs = contents.map((content) => ({ sha256: sha256(content), size: Buffer.byteLength(content) }));
  const plan = await api(token, 'POST', `/v1/projects/${projectId}/blobs/uploads`, { blobs });
  for (const upload of plan.uploads) {
    const content = contents[blobs.findIndex((blob) => blob.sha256 === upload.sha256)]!;
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: content });
    if (!put.ok) throw new Error(`upload failed: ${put.status}`);
  }
  if (plan.uploads.length) await api(token, 'POST', `/v1/projects/${projectId}/blobs/complete`, { uploadIds: plan.uploads.map((upload: { uploadId: string }) => upload.uploadId) });
  await api(token, 'POST', `/v1/branches/${branchId}/commits`, {
    parentId: checkout.headCommitId,
    machine: 'e2e',
    kind: 'version',
    message: 'e2e',
    files: Object.keys(files).map((path, index) => ({ path, blob: blobs[index]!.sha256 })),
  });
  await api(token, 'POST', `/v1/branches/${branchId}/checkin`);
}

async function logInAs(page: Page, person: Person) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(person.email);
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/app');
}

/** The focused element's tag and name, to check focus didn't fall to the page. */
const focused = (page: Page) => page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.getAttribute('name') ?? document.activeElement?.textContent?.trim() ?? ''}`);

const formError = (page: Page) => page.locator('#main .form-status.is-error');

interface World {
  owner: Person;
  slug: string;
  projectId: string;
}

let world: World;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const owner = await createPerson('forms');
  const slug = `bench-${randomUUID().slice(0, 6)}`;
  const project = await api(owner.token, 'POST', '/v1/projects', { slug, name: 'Test bench', visibility: 'public' });
  const branch = await api(owner.token, 'POST', `/v1/projects/${project.id}/branches`, { name: 'initial' });
  await commitVersion(owner.token, project.id, branch.id, { 'Bench.SLDASM': `bench ${slug}`, 'parts/Leg.SLDPRT': `leg ${slug}` });
  const request = await api(owner.token, 'POST', `/v1/branches/${branch.id}/release-requests`, { title: 'First bench' });
  const requestId = request.releaseRequest.id;
  await api(owner.token, 'POST', `/v1/release-requests/${requestId}/candidate`);
  // Approvals and releases name the candidate they're for.
  const { candidate } = await api(owner.token, 'GET', `/v1/release-requests/${requestId}`);
  for (const step of ['approvals', 'release']) await api(owner.token, 'POST', `/v1/release-requests/${requestId}/${step}`, { candidateManifestId: candidate.manifestId });
  world = { owner, slug, projectId: project.id };
});

const projectUrl = (...rest: (string | number)[]) => ['', world.owner.handle, world.slug, ...rest].join('/');

test('a fork that fails keeps every field, stays private, and focuses the address', async ({ page }) => {
  await logInAs(page, world.owner);
  await page.goto(projectUrl('fork'));
  // Forks start private, even from a public project.
  await expect(page.getByLabel('Visibility')).toHaveValue('private');
  await page.getByLabel('Name').fill('My bench');
  // Its own address is taken.
  await page.getByLabel('Address').fill(world.slug);
  await page.getByRole('button', { name: 'Fork project' }).click();
  await expect(formError(page)).toHaveText('You already have a project at that address. Choose another.');
  await expect(page.getByLabel('Visibility')).toHaveValue('private');
  await expect(page.getByLabel('Name')).toHaveValue('My bench');
  await expect(page.getByLabel('Address')).toBeFocused();

  await page.getByLabel('Address').fill(`${world.slug}-fork`);
  await page.getByRole('button', { name: 'Fork project' }).click();
  await page.waitForURL(`**/${world.owner.handle}/${world.slug}-fork`);
  const fork = await api(world.owner.token, 'GET', `/v1/users/${world.owner.handle}/projects/${world.slug}-fork`);
  expect(fork.visibility).toBe('private');
  // The sidebar lists the new project without a reload.
  await expect(page.locator('.shell-sidebar').getByRole('link', { name: 'My bench' })).toBeVisible();
});

test('a new project, branch and request keep what was typed after an error', async ({ page }) => {
  await logInAs(page, world.owner);
  await page.goto('/new');
  await page.getByLabel('Name').fill('Bench');
  await page.getByLabel('Address').fill(world.slug);
  await page.getByLabel(/^Description/).fill('A sturdier bench');
  await page.getByLabel(/^Public/).check();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(formError(page)).toHaveText('You already have a project at that address. Choose another.');
  await expect(page.getByLabel(/^Description/)).toHaveValue('A sturdier bench');
  await expect(page.getByLabel(/^Public/)).toBeChecked();

  await page.goto(projectUrl('branches'));
  await page.getByLabel('Name').fill('initial');
  await page.getByLabel('Start from').selectOption('1');
  await page.getByRole('button', { name: 'Create branch' }).click();
  await expect(formError(page)).toHaveText('A branch with that name already exists.');
  await expect(page.getByLabel('Name')).toHaveValue('initial');
  await expect(page.getByLabel('Name')).toBeFocused();

  // A new branch shows in the sidebar at once, with one next step on its page.
  const name = `wider-${randomUUID().slice(0, 4)}`;
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create branch' }).click();
  await page.waitForURL(`**/branches/${name}`);
  await expect(page.locator('.shell-sidebar').getByRole('link', { name })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Start working on ${name}` })).toBeVisible();
  await expect(page.getByText(`giga clone ${world.owner.handle}/${world.slug} --branch ${name}`)).toBeVisible();

  // Once it has a change, the branch offers a release request.
  const branches = await api(world.owner.token, 'GET', `/v1/projects/${world.projectId}/branches`);
  const created = branches.find((branch: { name: string }) => branch.name === name);
  await commitVersion(world.owner.token, world.projectId, created.id, { 'Bench.SLDASM': `wider ${randomUUID()}`, 'parts/Leg.SLDPRT': `leg ${world.slug}` });
  await page.reload();

  // A title of only spaces is caught with a sentence, not a validator message, and the description stays.
  await page.getByLabel('Title').fill('   ');
  await page.getByLabel(/^Description/).fill('Wider legs');
  await page.getByRole('button', { name: 'Open release request' }).click();
  await expect(formError(page)).toHaveText('Give the request a title.');
  await expect(page.getByLabel(/^Description/)).toHaveValue('Wider legs');
  await expect(page.getByLabel('Title')).toBeFocused();
});

test('a request that never reaches the server shows an inline error and keeps the form', async ({ page }) => {
  await logInAs(page, world.owner);
  await page.goto(projectUrl('settings'));
  await page.getByLabel('Description').fill('Typed while the network was down');
  // Server actions post to the page with a Next-Action header; fail just those.
  await page.route('**/*', (route) => (route.request().method() === 'POST' && route.request().headers()['next-action'] ? route.abort('internetdisconnected') : route.fallback()));
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(formError(page)).toHaveText(/didn’t go through|offline/);
  await expect(page.getByRole('heading', { name: 'Project settings' })).toBeVisible();
  await expect(page.getByLabel('Description')).toHaveValue('Typed while the network was down');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('Saved goes away once the form changes again, and Discard changes puts the saved values back', async ({ page }) => {
  await logInAs(page, world.owner);
  await page.goto(projectUrl('settings'));
  const save = page.getByRole('button', { name: 'Save project' });
  await page.getByLabel('Description').fill('Oak top');
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saved.')).toBeVisible();
  // The button keeps keyboard focus while it saves and after.
  await expect(save).toBeFocused();

  await page.getByLabel('Description').fill('Pine top');
  await expect(page.getByText('Saved.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByLabel('Description')).toHaveValue('Oak top');
  await expect(page.getByRole('button', { name: 'Discard changes' })).toHaveCount(0);

  // A blank name says so in words, and focuses the field.
  await page.getByLabel('Name', { exact: true }).fill('  ');
  await save.click();
  await expect(formError(page)).toHaveText('Enter a name.');
  await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
});

test('moving a file and then renaming it leaves it in its new folder', async ({ page }) => {
  const docs = await api(world.owner.token, 'POST', `/v1/projects/${world.projectId}/directory/folders`, { parentId: null, name: 'Docs' });
  await logInAs(page, world.owner);
  await page.goto(projectUrl());
  await page.getByText('New folder').click();
  // The popover's field takes focus, and Escape closes it.
  await expect(page.getByLabel('Folder name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Folder name')).toBeHidden();

  await page.locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from(`notes ${randomUUID()}`) });
  await page.getByRole('row', { name: /notes\.txt/ }).getByRole('link', { name: 'notes.txt' }).click();
  await page.getByText('Rename or move').click();
  await page.getByLabel('Folder').selectOption({ label: 'Docs' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByLabel('Folder')).toHaveValue(docs.id);

  await page.getByLabel('Name', { exact: true }).fill('meeting notes.txt');
  await page.getByLabel('Name', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'meeting notes.txt' })).toBeVisible();
  await expect(page.getByLabel('Folder')).toHaveValue(docs.id);
  const listing = await api(world.owner.token, 'GET', `/v1/projects/${world.projectId}/directory?path=Docs`);
  expect(JSON.stringify(listing)).toContain('meeting notes.txt');
});

test('confirming asks with focus on Cancel, Escape backs out, and the result outlives the row', async ({ page }) => {
  const mate = await createPerson('mate');
  await api(world.owner.token, 'PUT', `/v1/projects/${world.projectId}/members`, { handle: mate.handle, role: 'contributor' });
  const theirs = `mate-${randomUUID().slice(0, 4)}`;
  await api(mate.token, 'POST', `/v1/projects/${world.projectId}/branches`, { name: theirs });
  await logInAs(page, world.owner);
  await page.goto(projectUrl('settings'));
  const row = page.getByRole('row', { name: new RegExp(mate.handle) });
  const remove = row.getByRole('button', { name: 'Remove' });
  await remove.click();
  await expect(row.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(remove).toBeFocused();

  await remove.click();
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.action-toast')).toHaveText(new RegExp(`Removed @${mate.handle}\\.`));
  await expect(page.getByRole('row', { name: new RegExp(mate.handle) })).toHaveCount(0);
  expect(await focused(page)).not.toMatch(/^BODY/);

  // An unknown handle gets a sentence, and the form keeps it to fix.
  await page.getByLabel('Handle').fill('no-such-person-here');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(formError(page)).toHaveText('No one has the handle @no-such-person-here. Check the spelling, or ask them to sign up first.');
  await expect(page.getByLabel('Handle')).toHaveValue('no-such-person-here');

  // Activity still names the person who left, and links the request.
  await page.goto(projectUrl('activity'));
  await expect(page.getByText(`@${world.owner.handle} removed @${mate.handle}`)).toBeVisible();
  await expect(page.locator('.activity-page').getByText(`@${mate.handle} created branch ${theirs}`)).toBeVisible();
  await expect(page.locator('.activity-page').getByRole('link', { name: '#1 First bench' }).first()).toBeVisible();
  await expect(page.locator('.app-nav-sections').getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
});

test('the dashboard shows what needs you: a request to review and a lock you hold', async ({ browser }) => {
  const requester = await createPerson('asker');
  const reviewer = await createPerson('reviewer');
  await api(world.owner.token, 'PUT', `/v1/projects/${world.projectId}/members`, { handle: requester.handle, role: 'contributor' });
  await api(world.owner.token, 'PUT', `/v1/projects/${world.projectId}/members`, { handle: reviewer.handle, role: 'maintainer' });
  await api(world.owner.token, 'PUT', `/v1/projects/${world.projectId}/approval-rules`, { requiredCount: 1, approverRoles: ['maintainer'], approverUserIds: [], allowSelfApproval: false, requireCleanRebuild: false });
  const branch = await api(requester.token, 'POST', `/v1/projects/${world.projectId}/branches`, { name: `taller-${randomUUID().slice(0, 4)}`, fromRelease: 1 });
  await commitVersion(requester.token, world.projectId, branch.id, { 'Bench.SLDASM': `taller ${randomUUID()}`, 'parts/Leg.SLDPRT': `leg ${world.slug}` });
  const request = await api(requester.token, 'POST', `/v1/branches/${branch.id}/release-requests`, { title: 'Taller legs' });
  await api(requester.token, 'POST', `/v1/release-requests/${request.releaseRequest.id}/candidate`);
  const held = await api(reviewer.token, 'POST', `/v1/projects/${world.projectId}/branches`, { name: `brace-${randomUUID().slice(0, 4)}`, fromRelease: 1 });
  await api(reviewer.token, 'POST', `/v1/branches/${held.id}/checkout`, { machine: 'Shop-PC' });

  const page = await (await browser.newContext()).newPage();
  await logInAs(page, reviewer);
  const needs = page.getByRole('region', { name: /Needs you/ });
  const review = needs.getByRole('link', { name: `Review #${request.releaseRequest.number} Taller legs` });
  await expect(review).toBeVisible();
  await expect(needs.getByText(`You have ${held.name} checked out`)).toBeVisible();
  await review.click();
  await page.waitForURL(`**/release-requests/${request.releaseRequest.number}`);

  // The request list says where approvals stand.
  await page.goto(projectUrl('release-requests'));
  await expect(page.getByRole('row', { name: /Taller legs/ }).getByText('0 of 1 approvals')).toBeVisible();

  // The requester isn't asked to review their own request.
  const asker = await (await browser.newContext()).newPage();
  await logInAs(asker, requester);
  await expect(asker.getByRole('region', { name: /Needs you/ }).getByText('Nothing is waiting on you.')).toBeVisible();
  await asker.context().close();
  await page.context().close();
});

test('a mistyped address inside a project keeps the shell and links back', async ({ page }) => {
  await logInAs(page, world.owner);
  const missing = await page.goto(projectUrl('settngs'));
  expect(missing?.status()).toBe(404);
  await expect(page).toHaveTitle(/^Not found/);
  await page.getByRole('link', { name: 'Back to Test bench' }).click();
  await page.waitForURL(`**${projectUrl()}`);

  // A missing branch's or folder's title doesn't repeat the name from the address.
  await page.goto(projectUrl('branches', 'secret-plans'));
  await expect(page).toHaveTitle(/^Not found/);
  await page.goto(projectUrl('tree', 'Docs', 'secret-plans'));
  await expect(page).toHaveTitle(/^Not found/);
});
