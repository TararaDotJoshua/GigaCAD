import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import type { Sql } from './db.js';

export interface Caller {
  readonly userId: string;
  /** `session`: a Supabase login from the website. `device`: a long-lived token for the desktop client, add-in, or CLI. */
  readonly via: 'session' | 'device';
  /** For a device token: its id and the name the client gave itself when it signed in. */
  readonly tokenId?: string;
  readonly deviceName?: string;
}

export type Authenticate = (authorization: string | undefined) => Promise<Caller | null>;

export const DEVICE_TOKEN_PREFIX = 'gcd_';

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function newDeviceToken(): string {
  return DEVICE_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

/** How long a session is trusted after it was last seen in auth.sessions. Bounds how long a revoked one keeps working. */
const SESSION_CHECK_MS = 30_000;

export function createAuthenticator(options: { sql: Sql; supabaseUrl: string; jwtSecret?: string | undefined }): Authenticate {
  const { sql, supabaseUrl } = options;
  // A signed JWT stays valid until it expires, even after Log out everywhere or a password
  // change ends its session. So the session it names must still exist, checked every 30 s.
  const liveSessions = new Map<string, number>();
  async function sessionIsLive(sessionId: string): Promise<boolean> {
    const checked = liveSessions.get(sessionId);
    if (checked && Date.now() - checked < SESSION_CHECK_MS) return true;
    const [row] = await sql`select 1 from auth.sessions where id = ${sessionId} and (not_after is null or not_after > now())`;
    if (liveSessions.size > 10_000) liveSessions.clear();
    if (row) liveSessions.set(sessionId, Date.now());
    else liveSessions.delete(sessionId);
    return Boolean(row);
  }
  const issuer = new URL('/auth/v1', supabaseUrl).toString();
  const jwks = createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl));
  const secret = options.jwtSecret ? new TextEncoder().encode(options.jwtSecret) : undefined;

  async function verifySession(token: string): Promise<JWTPayload | null> {
    try {
      const { alg } = decodeProtectedHeader(token);
      const verifyOptions = { issuer, audience: 'authenticated' };
      if (alg === 'HS256') {
        if (!secret) return null;
        return (await jwtVerify(token, secret, verifyOptions)).payload;
      }
      return (await jwtVerify(token, jwks, verifyOptions)).payload;
    } catch {
      return null;
    }
  }

  return async (authorization) => {
    const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return null;

    if (token.startsWith(DEVICE_TOKEN_PREFIX)) {
      const [row] = await sql<{ id: string; userId: string; name: string }[]>`
        update device_tokens set last_used_at = now()
        where token_hash = ${hashSecret(token)} and revoked_at is null
        returning id, user_id, name
      `;
      return row ? { userId: row.userId, via: 'device', tokenId: row.id, deviceName: row.name } : null;
    }

    const payload = await verifySession(token);
    if (!payload?.sub) return null;
    const sessionId = payload.session_id;
    if (typeof sessionId === 'string' && !(await sessionIsLive(sessionId))) return null;
    return { userId: payload.sub, via: 'session' };
  };
}
