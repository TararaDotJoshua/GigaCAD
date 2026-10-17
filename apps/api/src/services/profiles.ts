import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type { ContributionDay } from '@gigacad/core';
import type { Sql } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import type { BlobStorage } from '../storage.js';
import { crc32 } from '../thumbnails/png.js';

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

export interface ProfileMatch {
  readonly handle: string;
  readonly displayName: string | null;
  readonly avatarKey: string | null;
}

/**
 * People whose handle or name starts with the query, for picking someone to add to a
 * project. Accounts that haven't chosen a handle yet are left out.
 */
export async function searchProfiles(sql: Sql, query: string, limit = 8): Promise<ProfileMatch[]> {
  const prefix = `${query.toLowerCase().replace(/^@/, '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql<ProfileMatch[]>`
    select handle, display_name, avatar_key from profiles
    where (handle like ${prefix} or lower(display_name) like ${prefix}) and handle !~ '^user-[0-9a-f]{12}$'
    order by handle like ${prefix} desc, handle
    limit ${limit}
  `;
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
    select 'release', r.created_at, r.project_id, r.number, rr.title, null, null, null
    from releases r left join release_requests rr on rr.id = r.release_request_id
    where r.created_by = ${userId} and r.created_at >= ${since}
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

/**
 * A link to an avatar that stays the same all day, so browsers reuse the cached image
 * instead of downloading it on every page, and that keeps working in tabs left open.
 */
export async function avatarUrl(storage: BlobStorage, key: string | null): Promise<string | null> {
  return key ? storage.presignDownload(key, undefined, undefined, { stable: true }) : null;
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

/** The largest avatar accepted: 2048 pixels a side as 8-bit RGBA, once decompressed. Avatars show at 240px at most. */
const MAX_AVATAR_PIXEL_BYTES = 2048 * (1 + 2048 * 4);

/** Channels per PNG colour type: grey, RGB, palette, grey and alpha, RGBA. */
const PNG_CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Adam7's seven passes: x start, y start, x step, y step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** Exactly how many bytes a PNG's image data inflates to: each row's pixels plus its filter byte. */
function pngPixelBytes(width: number, height: number, bitsPerPixel: number, interlaced: boolean): number {
  const rows = (w: number, h: number) => (w > 0 && h > 0 ? h * (1 + Math.ceil((w * bitsPerPixel) / 8)) : 0);
  if (!interlaced) return rows(width, height);
  return ADAM7.reduce((sum, [x, y, dx, dy]) => sum + rows(Math.ceil((width - x) / dx), Math.ceil((height - y) / dy)), 0);
}

/**
 * What's wrong with an avatar image, or null when it's fine: a file that only starts like an
 * image ('damaged') would be stored and shown broken everywhere. PNGs are checked through
 * their pixel data, which is inflated no further than the size their header declares, so a
 * small file can't unpack into gigabytes ('too_large'). JPEG and WebP are checked by their
 * headers and segments.
 */
export function avatarProblem(bytes: Uint8Array, type: (typeof AVATAR_TYPES)[number]): 'damaged' | 'too_large' | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  try {
    if (type === 'image/png') {
      let offset = 8;
      const data: Uint8Array[] = [];
      let expected = -1;
      while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset);
        const name = ascii(offset + 4, 4);
        if (offset + 12 + length > bytes.length) return 'damaged';
        if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) return 'damaged';
        if (expected < 0) {
          // The header comes first and says how big the image is.
          if (name !== 'IHDR' || length !== 13) return 'damaged';
          const [width, height] = [view.getUint32(offset + 8), view.getUint32(offset + 12)];
          const [depth, colour, interlace] = [bytes[offset + 16]!, bytes[offset + 17]!, bytes[offset + 20]!];
          const channels = PNG_CHANNELS[colour];
          if (!width || !height || !channels || ![1, 2, 4, 8, 16].includes(depth) || interlace > 1) return 'damaged';
          expected = pngPixelBytes(width, height, channels * depth, interlace === 1);
          if (expected > MAX_AVATAR_PIXEL_BYTES) return 'too_large';
        }
        if (name === 'IDAT') data.push(bytes.subarray(offset + 8, offset + 8 + length));
        if (name === 'IEND') {
          if (data.length === 0) return 'damaged';
          // Anything that inflates past the declared size throws a RangeError, caught below.
          return inflateSync(Buffer.concat(data), { maxOutputLength: expected }).length === expected ? null : 'damaged';
        }
        offset += 12 + length;
      }
      return 'damaged';
    }
    if (type === 'image/jpeg') {
      let offset = 2;
      let frame = false;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) return 'damaged';
        const marker = bytes[offset + 1]!;
        if (marker === 0xd9) return 'damaged';
        const length = view.getUint16(offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length) return 'damaged';
        // Start of frame (not DHT, JPG, or DAC, which share the range): it has the image size.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          frame = view.getUint16(offset + 5) > 0 && view.getUint16(offset + 7) > 0;
        }
        // Start of scan: the compressed data follows, ending at an end-of-image marker. Some
        // cameras and phones write more after it (padding, their own trailers), which is fine.
        if (marker === 0xda) {
          const scan = offset + 2 + length;
          for (let end = bytes.length - 2; end >= scan; end--) if (bytes[end] === 0xff && bytes[end + 1] === 0xd9) return frame ? null : 'damaged';
          return 'damaged';
        }
        offset += 2 + length;
      }
      return 'damaged';
    }
    const size = view.getUint32(4, true);
    if (size + 8 > bytes.length || size < 12) return 'damaged';
    const chunk = ascii(12, 4);
    return ['VP8 ', 'VP8L', 'VP8X'].includes(chunk) && 20 + view.getUint32(16, true) <= size + 8 ? null : 'damaged';
  } catch {
    return 'damaged';
  }
}

/** Whether an avatar image is whole and small enough to store. */
export const avatarIntact = (bytes: Uint8Array, type: (typeof AVATAR_TYPES)[number]): boolean => avatarProblem(bytes, type) === null;

/** Avatars are stored once per upload under a new key, so they can be cached for good. */
const AVATAR_CACHE = 'public, max-age=31536000, immutable';

/** Stores a new avatar and deletes the one it replaces. */
export async function setAvatar(sql: Sql, storage: BlobStorage, userId: string, bytes: Uint8Array): Promise<string> {
  const type = avatarType(bytes);
  if (!type) throw badRequest('invalid_image', 'Upload a PNG, JPEG, or WebP image');
  if (bytes.length > MAX_AVATAR_BYTES) throw badRequest('image_too_large', 'Upload an image of 1 MB or less');
  const problem = avatarProblem(bytes, type);
  if (problem === 'too_large') throw badRequest('image_too_large', 'Upload a smaller image: at most 2048 by 2048 pixels');
  if (problem) throw badRequest('invalid_image', 'That image can’t be opened. It may be damaged; try another');
  const key = `avatars/${userId}/${randomUUID()}`;
  await storage.write(key, bytes, type, AVATAR_CACHE);
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
