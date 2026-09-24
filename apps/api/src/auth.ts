import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import type { Sql } from './db.js';

export interface Caller {
  readonly userId: string;
  /** `session`: a Supabase login from the website. `device`: a long-lived token for the desktop client, add-in, or CLI. */
  readonly via: 'session' | 'device';
}

export type Authenticate = (authorization: string | undefined) => Promise<Caller | null>;

export const DEVICE_TOKEN_PREFIX = 'gcd_';

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function newDeviceToken(): string {
  return DEVICE_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function createAuthenticator(options: { sql: Sql; supabaseUrl: string; jwtSecret?: string | undefined }): Authenticate {
  const { sql, supabaseUrl } = options;
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
      const [row] = await sql<{ userId: string }[]>`
        update device_tokens set last_used_at = now()
        where token_hash = ${hashSecret(token)} and revoked_at is null
        returning user_id
      `;
      return row ? { userId: row.userId, via: 'device' } : null;
    }

    const payload = await verifySession(token);
    return payload?.sub ? { userId: payload.sub, via: 'session' } : null;
  };
}
