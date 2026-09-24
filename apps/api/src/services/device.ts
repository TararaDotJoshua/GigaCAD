import { randomBytes, randomInt } from 'node:crypto';
import { hashSecret, newDeviceToken } from '../auth.js';
import type { Db, Sql } from '../db.js';
import { badRequest, notFound } from '../errors.js';

const CODE_LIFETIME_SECONDS = 10 * 60;
const POLL_INTERVAL_SECONDS = 5;
// No 0/O, 1/I/L, so codes survive being read aloud or retyped.
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newUserCode(): string {
  const chars = Array.from({ length: 8 }, () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** Step 1 of desktop sign-in (RFC 8628 style): the client shows the user code and polls. */
export async function startDeviceSignIn(sql: Sql, webOrigin: string, clientName: string) {
  const deviceCode = randomBytes(32).toString('base64url');
  const userCode = newUserCode();
  await sql`
    insert into device_codes (device_code_hash, user_code, client_name, expires_at)
    values (${hashSecret(deviceCode)}, ${userCode}, ${clientName}, now() + make_interval(secs => ${CODE_LIFETIME_SECONDS}))
  `;
  return {
    deviceCode,
    userCode,
    verificationUri: new URL('/device', webOrigin).toString(),
    verificationUriComplete: new URL(`/device?code=${userCode}`, webOrigin).toString(),
    expiresIn: CODE_LIFETIME_SECONDS,
    interval: POLL_INTERVAL_SECONDS,
  };
}

/** Step 2: the signed-in user confirms the code on the website. */
export async function approveDeviceSignIn(sql: Sql, userId: string, userCode: string): Promise<{ clientName: string }> {
  const [row] = await sql<{ clientName: string }[]>`
    update device_codes set approved_by = ${userId}
    where user_code = ${userCode.trim().toUpperCase()} and expires_at > now() and approved_by is null and consumed_at is null
    returning client_name
  `;
  if (!row) throw notFound('Sign-in code');
  return row;
}

/** Shows the signed-in approver which client they are authorizing. */
export async function pendingDeviceSignIn(sql: Sql, userCode: string): Promise<{ clientName: string; expiresAt: Date }> {
  const [row] = await sql<{ clientName: string; expiresAt: Date }[]>`
    select client_name, expires_at from device_codes
    where user_code = ${userCode.trim().toUpperCase()} and expires_at > now()
      and approved_by is null and consumed_at is null
  `;
  if (!row) throw notFound('Sign-in code');
  return row;
}

/** Step 3: the polling client exchanges its device code for a long-lived token, exactly once. */
export async function pollDeviceSignIn(sql: Sql, deviceCode: string): Promise<IssuedToken> {
  return sql.begin(async (tx) => {
    const [row] = await tx<{ approvedBy: string | null; consumedAt: Date | null; expired: boolean; clientName: string }[]>`
      select approved_by, consumed_at, expires_at <= now() as expired, client_name
      from device_codes where device_code_hash = ${hashSecret(deviceCode)} for update
    `;
    if (!row || row.consumedAt) throw badRequest('invalid_grant', 'Unknown or already used sign-in code');
    if (row.expired) throw badRequest('expired_token', 'The sign-in code expired; start again');
    if (!row.approvedBy) throw badRequest('authorization_pending', 'Waiting for approval on the website');

    await tx`update device_codes set consumed_at = now() where device_code_hash = ${hashSecret(deviceCode)}`;
    return issueToken(tx, row.approvedBy, row.clientName);
  });
}

export interface IssuedToken {
  readonly accessToken: string;
  /** Lets the client revoke exactly this token (DELETE /v1/me/tokens/:id) when it signs out. */
  readonly tokenId: string;
}

export async function issueToken(db: Db, userId: string, name: string): Promise<IssuedToken> {
  const accessToken = newDeviceToken();
  const [row] = await db<{ id: string }[]>`
    insert into device_tokens (user_id, token_hash, name) values (${userId}, ${hashSecret(accessToken)}, ${name})
    returning id
  `;
  return { accessToken, tokenId: row!.id };
}

export async function listTokens(sql: Sql, userId: string) {
  return sql<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null }[]>`
    select id, name, created_at, last_used_at from device_tokens
    where user_id = ${userId} and revoked_at is null
    order by created_at desc
  `;
}

export async function revokeToken(sql: Sql, userId: string, tokenId: string): Promise<void> {
  const result = await sql`
    update device_tokens set revoked_at = now() where id = ${tokenId} and user_id = ${userId} and revoked_at is null
  `;
  if (result.count === 0) throw notFound('Token');
}
