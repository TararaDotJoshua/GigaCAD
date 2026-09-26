import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

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

/** Check out, upload through the presigned URLs, commit a version, and check in, like the CLI does. */
async function commitVersion(token: string, projectId: string, branchId: string, files: Record<string, string>) {
  const checkout = await api(token, 'POST', `/v1/branches/${branchId}/checkout`, { machine: 'e2e' });
  const contents = Object.values(files);
  const blobs = contents.map((content) => ({ sha256: sha256(content), size: Buffer.byteLength(content) }));
  const plan = await api(token, 'POST', `/v1/projects/${projectId}/blobs/uploads`, { blobs });
  for (const upload of plan.uploads) {
    const content = contents[blobs.findIndex((blob) => blob.sha256 === upload.sha256)]!;
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: content });
    if (!put.ok) throw new Error(`upload failed: ${put.status} ${await put.text()}`);
  }
  if (plan.uploads.length > 0) {
    const done = await api(token, 'POST', `/v1/projects/${projectId}/blobs/complete`, { uploadIds: plan.uploads.map((upload: { uploadId: string }) => upload.uploadId) });
    if (done.failed.length > 0) throw new Error(`upload failed: ${JSON.stringify(done.failed)}`);
  }
  const commit = await api(token, 'POST', `/v1/branches/${branchId}/commits`, {
    parentId: checkout.headCommitId,
    machine: 'e2e',
    kind: 'version',
    message: 'e2e',
    files: Object.keys(files).map((path, index) => ({ path, blob: blobs[index]!.sha256 })),
  });
  await api(token, 'POST', `/v1/branches/${branchId}/checkin`);
  return commit as { commit: { id: string }; files: { itemId: string; path: string }[] };
}

interface World {
  email: string;
  password: string;
  token: string;
  handle: string;
  slug: string;
  projectId: string;
  branchName: string;
  commitId: string;
  requestNumber: number;
}

let world: World;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const email = `e2e-${randomUUID().slice(0, 8)}@test.gigacad.site`;
  const password = `pw-${randomUUID()}`;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const signedIn = await createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const token = signedIn.data.session.access_token;
  const handle = `e2e-${randomUUID().slice(0, 8)}`;
  await api(token, 'PATCH', '/v1/me', { handle });

  // v1 on main: an assembly and three parts, released through the API.
  const slug = 'robot';
  const project = await api(token, 'POST', '/v1/projects', { slug, name: 'Robot', visibility: 'private' });
  const initial = await api(token, 'POST', `/v1/projects/${project.id}/branches`, { name: 'initial' });
  await commitVersion(token, project.id, initial.id, {
    'Robot.SLDASM': 'asm v1',
    'parts/P1.SLDPRT': 'p1 v1',
    'parts/P2.SLDPRT': 'p2 v1',
    'parts/P4.SLDPRT': 'p4 v1',
  });
  const first = await api(token, 'POST', `/v1/branches/${initial.id}/release-requests`, { title: 'First release' });
  await api(token, 'POST', `/v1/release-requests/${first.releaseRequest.id}/candidate`);
  await api(token, 'POST', `/v1/release-requests/${first.releaseRequest.id}/approvals`);
  await api(token, 'POST', `/v1/release-requests/${first.releaseRequest.id}/release`);

  // A branch from v1 edits P1 and P2, drops P4, and adds P3 to replace it.
  const branchName = 'swap-p4';
  const branch = await api(token, 'POST', `/v1/projects/${project.id}/branches`, { name: branchName, fromRelease: 1 });
  const committed = await commitVersion(token, project.id, branch.id, {
    'Robot.SLDASM': 'asm v1',
    'parts/P1.SLDPRT': 'p1 from branch',
    'parts/P2.SLDPRT': 'p2 from branch',
    'parts/P3.SLDPRT': 'p3 from branch',
  });
  const request = await api(token, 'POST', `/v1/branches/${branch.id}/release-requests`, { title: 'Swap P4 for P3' });

  world = { email, password, token, handle, slug, projectId: project.id, branchName, commitId: committed.commit.id, requestNumber: request.releaseRequest.number };
});

async function logIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(world.email);
  await page.getByLabel('Password', { exact: true }).fill(world.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/app');
}

const projectUrl = (...rest: (string | number)[]) => ['', world.handle, world.slug, ...rest].join('/');

test('picks files, generates the candidate, approves, and releases', async ({ page }) => {
  await logIn(page);
  await page.goto(projectUrl('release-requests', world.requestNumber));

  const pickFor = (path: string) => page.locator(`[aria-label="Pick for ${path}"]`);
  await pickFor('parts/P1.SLDPRT').getByRole('button', { name: 'Keep main' }).click();
  await pickFor('parts/P2.SLDPRT').getByRole('button', { name: 'Take branch' }).click();
  await page.getByLabel('Replace main item with parts/P3.SLDPRT').selectOption({ label: 'parts/P4.SLDPRT' });
  await page.getByRole('button', { name: 'Save picks' }).click();
  await expect(page.getByText('Unsaved picks')).toBeHidden();

  await page.getByRole('button', { name: 'Generate candidate' }).click();
  await expect(page.getByText('Up to date')).toBeVisible();
  await page.getByRole('button', { name: 'Approve candidate' }).click();
  await expect(page.getByRole('button', { name: 'Withdraw approval' })).toBeVisible();
  await page.getByRole('button', { name: 'Release v2' }).click();
  await page.waitForURL(`**${projectUrl('releases', 2)}`);

  // Main's P1, the branch's P2, and P3 in P4's place, keeping P4's item ID.
  const v1 = await api(world.token, 'GET', `/v1/projects/${world.projectId}/releases/1`);
  const v2 = await api(world.token, 'GET', `/v1/projects/${world.projectId}/releases/2`);
  const itemId = (path: string) => v1.files.find((file: { path: string }) => file.path === path).itemId;
  expect(v2.files).toEqual([
    { itemId: itemId('parts/P1.SLDPRT'), path: 'parts/P1.SLDPRT', blob: sha256('p1 v1') },
    { itemId: itemId('parts/P2.SLDPRT'), path: 'parts/P2.SLDPRT', blob: sha256('p2 from branch') },
    { itemId: itemId('parts/P4.SLDPRT'), path: 'parts/P3.SLDPRT', blob: sha256('p3 from branch') },
    { itemId: itemId('Robot.SLDASM'), path: 'Robot.SLDASM', blob: sha256('asm v1') },
  ]);
});

test('refreshes a private project page when something happens in it', async ({ page }) => {
  await logIn(page);
  // Realtime confirms the Postgres subscription once row-level security has let the session in.
  const subscribed = page.waitForEvent('websocket').then((socket) =>
    socket.waitForEvent('framereceived', { predicate: (frame) => String(frame.payload).includes('Subscribed to PostgreSQL') }),
  );
  await page.goto(projectUrl('branches'));
  await subscribed;

  const name = `live-${randomUUID().slice(0, 8)}`;
  await api(world.token, 'POST', `/v1/projects/${world.projectId}/branches`, { name });
  await expect(page.locator('#main').getByRole('link', { name })).toBeVisible();
});

test('shows storage used and the plans', async ({ page }) => {
  await logIn(page);
  await page.goto('/settings/billing');
  await expect(page.getByText(/^\d+ bytes of 5 GB used$/)).toBeVisible();
  await expect(page.getByRole('row', { name: /Free/ }).getByText('Current plan')).toBeVisible();
  // CI has no payment keys, so paid plans aren't open.
  await expect(page.getByRole('row', { name: /Maker/ }).getByText('Opens soon')).toBeVisible();
});

test('shares a public project: browse it signed out, star it, and fork it', async ({ page, browser }) => {
  const slug = `gearbox-${randomUUID().slice(0, 6)}`;
  const project = await api(world.token, 'POST', '/v1/projects', { slug, name: 'Public gearbox', visibility: 'public' });
  const branch = await api(world.token, 'POST', `/v1/projects/${project.id}/branches`, { name: 'initial' });
  await commitVersion(world.token, project.id, branch.id, { 'Gearbox.SLDASM': `gearbox ${slug}` });
  const request = await api(world.token, 'POST', `/v1/branches/${branch.id}/release-requests`, { title: 'v1' });
  for (const step of ['candidate', 'approvals', 'release']) await api(world.token, 'POST', `/v1/release-requests/${request.releaseRequest.id}/${step}`);

  // Anyone can find and open it.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/explore');
  await visitor.getByRole('link', { name: `${world.handle}/Public gearbox` }).click();
  await expect(visitor.getByRole('heading', { name: 'Public gearbox' })).toBeVisible();
  await expect(visitor.getByRole('link', { name: /Star/ })).toHaveAttribute('href', /\/login\?next=/);
  await visitor.context().close();

  // Its owner stars and forks it.
  await logIn(page);
  await page.goto(`/${world.handle}/${slug}`);
  await page.getByRole('button', { name: /^Star this project/ }).click();
  await expect(page.getByRole('button', { name: /^Unstar this project, 1 star/ })).toBeVisible();
  await page.getByRole('link', { name: /Fork/ }).click();
  await page.getByLabel('Address').fill(`${slug}-fork`);
  await page.getByRole('button', { name: 'Fork project' }).click();
  await page.waitForURL(`**/${world.handle}/${slug}-fork`);
  await expect(page.getByText(`${world.handle}/${slug} v1`)).toBeVisible();
  await expect(page.locator('#main').getByText('Gearbox.SLDASM')).toBeVisible();
});

test('previews a 3D file in the browser', async ({ page }) => {
  // An ASCII STL tetrahedron, committed on its own branch.
  const facet = (a: string, b: string, c: string) => `facet normal 0 0 0\nouter loop\nvertex ${a}\nvertex ${b}\nvertex ${c}\nendloop\nendfacet`;
  const stl = ['solid bracket', facet('0 0 0', '10 0 0', '0 10 0'), facet('0 0 0', '0 0 10', '10 0 0'), facet('0 0 0', '0 10 0', '0 0 10'), facet('10 0 0', '0 0 10', '0 10 0'), 'endsolid bracket'].join('\n');
  const branch = await api(world.token, 'POST', `/v1/projects/${world.projectId}/branches`, { name: 'preview' });
  await commitVersion(world.token, world.projectId, branch.id, { 'parts/bracket.stl': stl });

  await logIn(page);
  await page.goto(projectUrl('branches', 'preview'));
  await page.getByRole('button', { name: 'Preview bracket.stl' }).click();
  const dialog = page.getByRole('dialog', { name: '3D preview of bracket.stl' });
  await expect(dialog.locator('canvas')).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('every page type answers with the right status', async ({ page, browser }) => {
  // Marketing and sign-in pages, signed out.
  const signedOut = await browser.newContext();
  const docs = await signedOut.request.get('/docs');
  const docPage = /href="(\/docs\/[^"#]+)"/.exec(await docs.text())?.[1];
  expect(docPage, 'the docs index links to a docs page').toBeTruthy();
  for (const path of ['/', '/docs', docPage!, '/download', '/pricing', '/privacy', '/terms', '/login', '/signup', '/forgot-password']) {
    expect((await signedOut.request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
  }
  // Explore and profiles are public. Account pages and private projects send visitors to sign in.
  for (const path of ['/explore', '/explore?sort=recent&q=gear', `/${world.handle}`]) {
    expect((await signedOut.request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
  }
  for (const path of ['/app', projectUrl()]) {
    const guarded = await signedOut.request.get(path, { maxRedirects: 0 });
    expect(guarded.status(), path).toBe(307);
    expect(guarded.headers().location, path).toContain('/login');
  }
  await signedOut.close();

  // Every product page, signed in.
  await logIn(page);
  const paths = [
    '/app',
    '/new',
    '/settings',
    '/settings/billing',
    '/explore',
    `/${world.handle}`,
    projectUrl(),
    projectUrl('fork'),
    projectUrl('branches'),
    projectUrl('branches', world.branchName),
    projectUrl('commits', world.commitId),
    projectUrl('release-requests'),
    projectUrl('release-requests', world.requestNumber),
    projectUrl('releases'),
    projectUrl('releases', 2),
    projectUrl('settings'),
  ];
  for (const path of paths) {
    expect((await page.request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
  }
  expect((await page.request.get(projectUrl('releases', 99), { maxRedirects: 0 })).status()).toBe(404);
});
