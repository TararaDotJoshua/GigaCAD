import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createAuthenticator } from '../src/auth.js';
import { createSql, type Sql } from '../src/db.js';
import type { Payments } from '../src/payments.js';
import type { BlobStorage, StoredObject } from '../src/storage.js';

// Defaults match `supabase start`; override with env vars to point elsewhere.
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');

/** In-memory stand-in for R2 that records the real SHA-256 of what was "uploaded", like R2 does. */
export class MemoryStorage implements BlobStorage {
  readonly objects = new Map<string, Buffer>();

  async presignUpload(key: string, sha: string) {
    return { url: `memory://${key}`, method: 'PUT' as const, headers: { 'x-amz-checksum-sha256': Buffer.from(sha, 'hex').toString('base64') } };
  }
  async presignDownload(key: string, filename?: string) {
    return `memory://${key}${filename ? `?filename=${encodeURIComponent(filename)}` : ''}`;
  }
  async stat(key: string): Promise<StoredObject | null> {
    const body = this.objects.get(key);
    return body ? { size: body.length, checksumSha256: createHash('sha256').update(body).digest('base64') } : null;
  }
  async copy(fromKey: string, toKey: string) {
    const body = this.objects.get(fromKey);
    if (!body) throw new Error(`missing ${fromKey}`);
    this.objects.set(toKey, body);
  }
  async remove(key: string) {
    this.objects.delete(key);
  }
  put(url: string, content: string) {
    this.objects.set(url.replace('memory://', ''), Buffer.from(content));
  }
}

export interface Harness {
  readonly app: FastifyInstance;
  readonly sql: Sql;
  readonly storage: MemoryStorage;
  close(): Promise<void>;
}

/** Enough of a harness to make requests; lets other packages' tests reuse these helpers with their own app. */
export type AppHarness = Pick<Harness, 'app'>;

export async function createHarness(options: { payments?: Payments } = {}): Promise<Harness> {
  const sql = createSql(DATABASE_URL);
  const storage = new MemoryStorage();
  const app = buildApp({
    sql,
    storage,
    authenticate: createAuthenticator({ sql, supabaseUrl: SUPABASE_URL, jwtSecret: JWT_SECRET }),
    webOrigin: 'http://localhost:3000',
    ...options,
  });
  await app.ready();
  return {
    app,
    sql,
    storage,
    async close() {
      await app.close();
      await sql.end({ timeout: 5 });
    },
  };
}

export interface TestUser {
  readonly id: string;
  readonly handle: string;
  readonly token: string;
}

/** Creates a real Supabase user, signs in, and gives them a unique handle. */
export async function createUser(harness: AppHarness, name: string): Promise<TestUser> {
  const email = `${name}-${randomUUID().slice(0, 8)}@test.gigacad.site`;
  const password = `pw-${randomUUID()}`;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const session = await anon.auth.signInWithPassword({ email, password });
  if (session.error) throw session.error;

  const token = session.data.session.access_token;
  const handle = `${name}-${randomUUID().slice(0, 8)}`;
  const response = await call(harness, token, 'PATCH', '/v1/me', { handle });
  if (response.status !== 200) throw new Error(`could not set handle: ${JSON.stringify(response.body)}`);
  return { id: created.data.user.id, handle, token };
}

export interface Response<T = any> {
  readonly status: number;
  readonly body: T;
}

export async function call<T = any>(
  harness: AppHarness,
  token: string | null,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
): Promise<Response<T>> {
  const response = await harness.app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: response.statusCode, body: (response.body ? response.json() : undefined) as T };
}

export function client(harness: AppHarness, user: TestUser | null) {
  const token = user?.token ?? null;
  return {
    get: <T = any>(url: string) => call<T>(harness, token, 'GET', url),
    post: <T = any>(url: string, body: unknown = {}) => call<T>(harness, token, 'POST', url, body),
    put: <T = any>(url: string, body: unknown) => call<T>(harness, token, 'PUT', url, body),
    patch: <T = any>(url: string, body: unknown) => call<T>(harness, token, 'PATCH', url, body),
    delete: <T = any>(url: string) => call<T>(harness, token, 'DELETE', url),
  };
}

export type Client = ReturnType<typeof client>;

/** Uploads file contents through the real upload flow and returns their hashes. */
export async function upload(harness: Harness, api: Client, projectId: string, contents: readonly string[]): Promise<string[]> {
  const blobs = contents.map((content) => ({ sha256: sha256(content), size: Buffer.byteLength(content) }));
  const plan = await api.post(`/v1/projects/${projectId}/blobs/uploads`, { blobs });
  if (plan.status !== 200) throw new Error(`upload plan failed: ${JSON.stringify(plan.body)}`);
  for (const item of plan.body.uploads) {
    harness.storage.put(item.url, contents[blobs.findIndex((blob) => blob.sha256 === item.sha256)]!);
  }
  if (plan.body.uploads.length > 0) {
    const done = await api.post(`/v1/projects/${projectId}/blobs/complete`, {
      uploadIds: plan.body.uploads.map((item: { uploadId: string }) => item.uploadId),
    });
    if (done.status !== 200 || done.body.failed.length > 0) throw new Error(`upload failed: ${JSON.stringify(done.body)}`);
  }
  return blobs.map((blob) => blob.sha256);
}

export const MACHINE = 'test-laptop';

/**
 * Check out a branch, save files to it (uploading as needed), commit a version, and check in.
 * `files` maps paths to contents; item ids are kept by path automatically.
 */
export async function commitVersion(
  harness: Harness,
  api: Client,
  projectId: string,
  branchId: string,
  files: Record<string, string>,
  options: { itemIds?: Record<string, string>; checkIn?: boolean } = {},
) {
  const checkout = await api.post(`/v1/branches/${branchId}/checkout`, { machine: MACHINE });
  if (checkout.status !== 200) throw new Error(`checkout failed: ${JSON.stringify(checkout.body)}`);
  const paths = Object.keys(files);
  const hashes = await upload(harness, api, projectId, Object.values(files));
  const commit = await api.post(`/v1/branches/${branchId}/commits`, {
    parentId: checkout.body.headCommitId,
    machine: MACHINE,
    kind: 'version',
    message: 'test',
    files: paths.map((path, index) => ({ path, blob: hashes[index], itemId: options.itemIds?.[path] })),
  });
  if (commit.status !== 201) throw new Error(`commit failed: ${JSON.stringify(commit.body)}`);
  if (options.checkIn !== false) await api.post(`/v1/branches/${branchId}/checkin`);
  return commit.body as { commit: { id: string }; files: { itemId: string; path: string; blob: string }[] };
}
