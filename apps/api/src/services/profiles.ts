import { randomUUID } from 'node:crypto';
import type { ContributionDay } from '@gigacad/core';
import type { Sql } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import type { BlobStorage } from '../storage.js';

export const MAX_AVATAR_BYTES = 1024 * 1024;
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Something a user did that shows on their page, in a project the viewer can read. */
export interface Activity {
  readonly kind: 'commit' | 'release_request' | 'release' | 'approval';
  readonly createdAt: Date;
  readonly ownerHandle: string;
  readonly projectSlug: string;
  readonly projectName: string;
  /** The release request's or release's number. */
  readonly number: number | null;
  /** The release request's title, or the commit's message. */
  readonly title: string | null;
  readonly versionLabel: string | null;
  readonly branchName: string | null;
  readonly commitId: string | null;
}

/**
 * Projects the viewer can read, as a condition on `p`: public ones, plus private ones
 * they're a member of. Deleted projects never count.
 */
export function visibleProject(sql: Sql, viewerId: string | null) {
  return sql`p.deleted_at is null and (p.visibility = 'public' ${
    viewerId ? sql`or exists (select 1 from project_members m where m.project_id = p.id and m.user_id = ${viewerId})` : sql``
  })`;
}

/**
 * A user's contributions: version commits, release requests they opened, releases they
 * made, and approvals they gave. Autosaves don't count (they're pruned anyway), and
 * neither does the empty first commit that starts every branch.
 */
function contributions(sql: Sql, userId: string, since: Date) {
  return sql`
    select 'commit' as kind, c.created_at, b.project_id, null::int as number, c.message as title, c.version_label, b.name as branch_name, c.id as commit_id
    from commits c join branches b on b.id = c.branch_id
    where c.author_id = ${userId} and c.kind = 'version' and c.parent_id is not null and c.created_at >= ${since}
    union all
    select 'release_request', rr.created_at, rr.project_id, rr.number, rr.title, null, null, null
    from release_requests rr where rr.requester_id = ${userId} and rr.created_at >= ${since}
    union all
    select 'release', r.created_at, r.project_id, r.number, null, null, null, null
    from releases r where r.created_by = ${userId} and r.created_at >= ${since}
    union all
    select 'approval', a.created_at, rr.project_id, rr.number, rr.title, null, null, null
    from approvals a join release_requests rr on rr.id = a.release_request_id
    where a.user_id = ${userId} and a.created_at >= ${since}
  `;
}

/** Contributions per UTC day over the last 53 weeks, for the graph on a user's page. */
export async function contributionDays(sql: Sql, userId: string, viewerId: string | null): Promise<ContributionDay[]> {
  const since = new Date(Date.now() - 371 * 86_400_000);
  return sql<ContributionDay[]>`
    select to_char((c.created_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day, count(*)::int as count
    from (${contributions(sql, userId, since)}) c
    join projects p on p.id = c.project_id
    where ${visibleProject(sql, viewerId)}
    group by 1 order by 1
  `;
}

export async function recentActivity(sql: Sql, userId: string, viewerId: string | null, limit = 20): Promise<Activity[]> {
  const since = new Date(Date.now() - 371 * 86_400_000);
  return sql<Activity[]>`
    select c.kind, c.created_at, o.handle as owner_handle, p.slug as project_slug, p.name as project_name,
           c.number, c.title, c.version_label, c.branch_name, c.commit_id
    from (${contributions(sql, userId, since)}) c
    join projects p on p.id = c.project_id
    join profiles o on o.id = p.owner_id
    where ${visibleProject(sql, viewerId)}
    order by c.created_at desc
    limit ${limit}
  `;
}

export async function avatarUrl(storage: BlobStorage, key: string | null): Promise<string | null> {
  return key ? storage.presignDownload(key) : null;
}

/** Swaps each row's avatar key for a short-lived link to the image. */
export async function withAvatars<T extends { avatarKey: string | null }>(
  storage: BlobStorage,
  rows: readonly T[],
): Promise<(Omit<T, 'avatarKey'> & { avatarUrl: string | null })[]> {
  return Promise.all(rows.map(async ({ avatarKey, ...row }) => ({ ...row, avatarUrl: await avatarUrl(storage, avatarKey) })));
}

/** The image type from the file's first bytes, or null if it isn't a PNG, JPEG, or WebP. */
export function avatarType(bytes: Uint8Array): (typeof AVATAR_TYPES)[number] | null {
  const starts = (signature: readonly number[], offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** Stores a new avatar and deletes the one it replaces. */
export async function setAvatar(sql: Sql, storage: BlobStorage, userId: string, bytes: Uint8Array): Promise<string> {
  const type = avatarType(bytes);
  if (!type) throw badRequest('invalid_image', 'Upload a PNG, JPEG, or WebP image');
  if (bytes.length > MAX_AVATAR_BYTES) throw badRequest('image_too_large', 'Upload an image of 1 MB or less');
  const key = `avatars/${userId}/${randomUUID()}`;
  await storage.write(key, bytes, type);
  const previous = await swapAvatarKey(sql, userId, key);
  if (previous) await removeQuietly(storage, previous);
  return (await avatarUrl(storage, key))!;
}

export async function clearAvatar(sql: Sql, storage: BlobStorage, userId: string): Promise<void> {
  const previous = await swapAvatarKey(sql, userId, null);
  if (previous) await removeQuietly(storage, previous);
}

async function swapAvatarKey(sql: Sql, userId: string, key: string | null): Promise<string | null> {
  return sql.begin(async (tx) => {
    const [row] = await tx<{ avatarKey: string | null }[]>`select avatar_key from profiles where id = ${userId} for update`;
    if (!row) throw notFound('Profile');
    await tx`update profiles set avatar_key = ${key} where id = ${userId}`;
    return row.avatarKey;
  });
}

/** The profile already points at the new avatar, so a failed delete only leaves an unused file behind. */
async function removeQuietly(storage: BlobStorage, key: string): Promise<void> {
  try {
    await storage.remove(key);
  } catch {
    // Nothing references it any more.
  }
}
