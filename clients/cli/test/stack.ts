import type { AddressInfo } from 'node:net';
import { buildApp } from '../../../apps/api/src/app.js';
import { createAuthenticator } from '../../../apps/api/src/auth.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import { createSql, type Sql } from '../../../apps/api/src/db.js';
import { createS3Storage } from '../../../apps/api/src/storage.js';
import { client, createUser, type TestUser } from '../../../apps/api/test/helpers.js';
import type { TestCli } from './context.js';

/**
 * The real API over HTTP with real storage (MinIO from `docker compose up`), backed by the
 * `supabase start` database. The CLI talks to it exactly as it would to production.
 */
export interface Stack {
  readonly app: ReturnType<typeof buildApp>;
  readonly sql: Sql;
  readonly apiUrl: string;
  close(): Promise<void>;
}

export async function startStack(): Promise<Stack> {
  const config = loadConfig({
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    SUPABASE_URL: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long',
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: process.env.S3_BUCKET ?? 'gigacad',
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'gigacad',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'gigacad-local-secret',
    S3_FORCE_PATH_STYLE: 'true',
    WEB_ORIGIN: 'http://localhost:3000',
  });
  const sql = createSql(config.DATABASE_URL);
  const app = buildApp({
    sql,
    storage: createS3Storage(config),
    authenticate: createAuthenticator({ sql, supabaseUrl: config.SUPABASE_URL, jwtSecret: config.SUPABASE_JWT_SECRET }),
    webOrigin: config.WEB_ORIGIN,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return {
    app,
    sql,
    apiUrl: `http://127.0.0.1:${port}`,
    async close() {
      await app.close();
      await sql.end({ timeout: 5 });
    },
  };
}

export async function newUser(stack: Stack, name: string): Promise<TestUser> {
  return createUser(stack, name);
}

/** Runs `giga login` and approves the code as `user` on the website, like a person would. */
export async function signIn(stack: Stack, cli: TestCli, user: TestUser) {
  let approval: Promise<unknown> | undefined;
  const result = await cli.run(['login', '--no-browser', '--json'], {
    onStderr: (text) => {
      const userCode = text.match(/enter the code ([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1];
      if (userCode && !approval) approval = client(stack, user).post('/v1/auth/device/approve', { userCode });
    },
  });
  const approved = (await approval) as { status: number } | undefined;
  if (approved?.status !== 200 || result.code !== 0) throw new Error(`login failed: ${result.stderr}`);
  return result;
}
