import { randomUUID } from 'node:crypto';
import { isPlaceholderHandle } from '@gigacad/core';
import type { Sql } from '../db.js';
import { forbidden, notFound, unprocessable } from '../errors.js';
import type { BlobStorage } from '../storage.js';
import { hasRole, projectAccess } from './access.js';
import { requireStorageFor } from './billing.js';
import { recordEvent } from './events.js';
import { snapshotReleaseExports } from './exports.js';
import { insertManifest, loadManifest } from './manifests.js';
import { avatarUrl, contributionDays, recentActivity, visibleProject } from './profiles.js';
import { requireChosenHandle, requireFreeAddress, summarize, type ProjectSummary } from './projects.js';

/** A public project as Explore and profile pages list it. */
export interface ProjectCard {
  readonly id: string;
  readonly ownerHandle: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: 'public' | 'private';
  readonly license: string | null;
  readonly createdAt: Date;
  readonly latestReleaseNumber: number | null;
  readonly starCount: number;
  /** Copied from another project's release. */
  readonly isFork: boolean;
  readonly thumbnailSha: string | null;
}

export async function starProject(sql: Sql, projectId: string, userId: string, starred: boolean): Promise<{ starred: boolean; starCount: number }> {
  await projectAccess(sql, projectId, userId);
  if (starred) await sql`insert into stars (user_id, project_id) values (${userId}, ${projectId}) on conflict do nothing`;
  else await sql`delete from stars where user_id = ${userId} and project_id = ${projectId}`;
  const [row] = await sql<{ starCount: number }[]>`select count(*)::int as star_count from stars where project_id = ${projectId}`;
  return { starred, starCount: row!.starCount };
}

export async function exploreProjects(
  sql: Sql,
  query: { q?: string | undefined; sort: 'stars' | 'recent'; limit: number; offset: number },
): Promise<ProjectCard[]> {
  const pattern = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return sql<ProjectCard[]>`
    select ${projectCardColumns(sql)}
    from projects p join profiles o on o.id = p.owner_id
    where p.visibility = 'public' and p.deleted_at is null
      ${pattern ? sql`and (p.name ilike ${pattern} or p.slug ilike ${pattern} or p.description ilike ${pattern} or o.handle ilike ${pattern})` : sql``}
    order by ${query.sort === 'stars' ? sql`star_count desc, p.created_at desc` : sql`p.created_at desc`}
    limit ${query.limit} offset ${query.offset}
  `;
}

/** What a project card shows, selected from `projects p` joined to its owner's `profiles o`. */
function projectCardColumns(sql: Sql) {
  return sql`
    p.id, o.handle as owner_handle, p.slug, p.name, p.description, p.visibility, p.license, p.created_at,
    (select max(number) from releases r where r.project_id = p.id) as latest_release_number,
    (select count(*)::int from stars s where s.project_id = p.id) as star_count,
    p.forked_from_release_id is not null as is_fork,
    coalesce(project_thumbnail(p.id), (
      -- A project that has only files uploaded in the browser: its largest root file with a thumbnail.
      select shown.sha256
      from directory_entries e
      cross join lateral (select r.blob_sha256 from root_file_revisions r where r.entry_id = e.id order by r.number desc limit 1) rv
      join blobs b on b.sha256 = rv.blob_sha256
      cross join lateral (select file_thumbnail(p.id, rv.blob_sha256) as sha256) shown
      where e.project_id = p.id and e.kind = 'file' and shown.sha256 is not null
      order by b.size desc, e.name
      limit 1
    )) as thumbnail_sha
  `;
}

interface ProfileRow {
  readonly id: string;
  readonly handle: string;
  readonly displayName: string | null;
  readonly bio: string | null;
  readonly location: string | null;
  readonly website: string | null;
  readonly avatarKey: string | null;
  readonly createdAt: Date;
}

/** A profile by handle. Accounts that haven't chosen a handle yet have no public page, except to themselves. */
async function profileByHandle(sql: Sql, handle: string, viewerId: string | null): Promise<ProfileRow> {
  const [profile] = await sql<ProfileRow[]>`
    select id, handle, display_name, bio, location, website, avatar_key, created_at from profiles where handle = ${handle.toLowerCase()}
  `;
  if (!profile || (isPlaceholderHandle(profile.handle) && profile.id !== viewerId)) throw notFound('User');
  return profile;
}

/**
 * A user's page: their profile, contributions, and recent activity, and their projects.
 * Everything is limited to projects the viewer can read, so you see your own private ones.
 */
export async function userProfile(sql: Sql, storage: BlobStorage, handle: string, viewerId: string | null) {
  const { id, avatarKey, ...profile } = await profileByHandle(sql, handle, viewerId);
  const [projects, contributions, activity, [stars]] = await Promise.all([
    sql<ProjectCard[]>`
      select ${projectCardColumns(sql)}
      from projects p join profiles o on o.id = p.owner_id
      where p.owner_id = ${id} and ${visibleProject(sql, viewerId)}
      order by p.created_at desc
    `,
    contributionDays(sql, id, viewerId),
    recentActivity(sql, id, viewerId),
    sql<{ count: number }[]>`
      select count(*)::int as count from stars s join projects p on p.id = s.project_id
      where s.user_id = ${id} and ${visibleProject(sql, viewerId)}
    `,
  ]);
  return {
    profile: { ...profile, avatarUrl: await avatarUrl(storage, avatarKey), starCount: stars!.count },
    projects,
    contributions,
    activity,
  };
}

/** Projects a user starred that the viewer can read, most recently starred first. */
export async function starredProjects(sql: Sql, handle: string, viewerId: string | null): Promise<ProjectCard[]> {
  const { id } = await profileByHandle(sql, handle, viewerId);
  return sql<ProjectCard[]>`
    select ${projectCardColumns(sql)}
    from stars s join projects p on p.id = s.project_id join profiles o on o.id = p.owner_id
    where s.user_id = ${id} and ${visibleProject(sql, viewerId)}
    order by s.created_at desc
  `;
}

/**
 * Copies a release into a new project owned by the caller, as its v1. Files keep their
 * content but get new item IDs, so the fork's history (and purge) stand alone. Stored
 * bytes are shared; the fork's owner is charged for them like any upload.
 */
export async function forkProject(
  sql: Sql,
  sourceId: string,
  userId: string,
  input: { slug: string; name: string; releaseNumber?: number | undefined; visibility?: 'public' | 'private' | undefined },
): Promise<ProjectSummary> {
  const { project: source, role } = await projectAccess(sql, sourceId, userId);
  // A private fork is a copy its maker keeps and can share after they leave, so it's for maintainers, not every viewer.
  if (source.visibility === 'private' && !hasRole(role, 'maintainer')) throw forbidden('Only maintainers can fork a private project');
  await requireChosenHandle(sql, userId);
  const visibility = input.visibility ?? source.visibility;
  if (source.visibility === 'private' && visibility === 'public') throw forbidden('A fork of a private project must stay private');

  const [release] = await sql<{ id: string; number: number; manifestId: string }[]>`
    select id, number, manifest_id from releases where project_id = ${sourceId}
    ${input.releaseNumber ? sql`and number = ${input.releaseNumber}` : sql``}
    order by number desc limit 1
  `;
  if (!release) throw input.releaseNumber ? notFound('Release') : unprocessable('nothing_to_fork', 'This project has no releases to fork yet');
  const [owner] = await sql<{ handle: string }[]>`select handle from profiles where id = ${source.ownerId}`;
  const entries = await loadManifest(sql, release.manifestId);
  // A release made just before the deploy that added export snapshots gets its snapshot from a job
  // within a minute; a fork in that window takes it now rather than copying no exports.
  const [snapshotted] = await sql`select 1 from release_export_snapshots where release_id = ${release.id}`;
  if (!snapshotted) await sql.begin((tx) => snapshotReleaseExports(tx, sourceId, release.id, release.manifestId));
  // The STEP and STL exports the release was made with come along, so the fork can be downloaded and previewed the same way.
  const exports = await sql<{ sourceSha256: string; format: string; blobSha256: string }[]>`
    select source_sha256, format, blob_sha256 from release_exports where release_id = ${release.id}
  `;
  const blobs = await sql<{ sha256: string; size: number }[]>`
    select sha256, size::float8 as size from blobs
    where sha256 = any(${[...new Set([...entries.map((entry) => entry.blob), ...exports.map((row) => row.blobSha256)])]}::text[])
  `;

  return sql.begin(async (tx) => {
    await requireFreeAddress(tx, userId, input.slug);
    await requireStorageFor(tx, userId, blobs);
    const [project] = await tx<{ id: string }[]>`
      insert into projects (owner_id, slug, name, description, visibility, license, forked_from_release_id, must_stay_private)
      values (${userId}, ${input.slug}, ${input.name}, ${source.description}, ${visibility}, ${source.license}, ${release.id}, ${source.visibility === 'private'})
      returning id
    `;
    const projectId = project!.id;
    await tx`insert into project_members (project_id, user_id, role) values (${projectId}, ${userId}, 'owner')`;
    await tx`insert into approval_rules (project_id) values (${projectId})`;

    const itemIds = entries.map(() => randomUUID());
    if (entries.length) await tx`insert into items ${tx(itemIds.map((id) => ({ id, projectId })))}`;
    if (blobs.length) {
      await tx`insert into project_blobs ${tx(blobs.map((blob) => ({ projectId, sha256: blob.sha256, uploadedBy: userId })))}`;
      await tx`
        insert into blob_references (project_id, sha256, referenced_path)
        select ${projectId}, sha256, referenced_path from blob_references
        where project_id = ${sourceId} and sha256 = any(${blobs.map((blob) => blob.sha256)}::text[])
      `;
    }
    if (exports.length) {
      await tx`insert into file_exports ${tx(exports.map((row) => ({ projectId, ...row, createdBy: userId })))}`;
    }
    const manifestId = await insertManifest(tx, projectId, entries.map((entry, index) => ({ ...entry, itemId: itemIds[index]! })));
    const [created] = await tx<{ id: string }[]>`
      insert into releases (project_id, number, manifest_id, notes, created_by)
      values (${projectId}, 1, ${manifestId}, ${`Forked from @${owner!.handle}/${source.slug} v${release.number}.`}, ${userId})
      returning id
    `;
    await snapshotReleaseExports(tx, projectId, created!.id, manifestId);
    const forkedFrom = { ownerHandle: owner!.handle, slug: source.slug, releaseNumber: release.number };
    await recordEvent(tx, { projectId, actorId: userId, kind: 'project_created', subjectId: projectId, payload: { forkedFrom, forkedFromRelease: release.id } });
    // The source's members hear about forks, except a private fork of a public project, which stays the forker's business.
    if (source.visibility === 'private' || visibility === 'public') {
      const [forker] = await tx<{ handle: string }[]>`select handle from profiles where id = ${userId}`;
      await recordEvent(tx, {
        projectId: sourceId,
        actorId: userId,
        kind: 'project_forked',
        subjectId: projectId,
        payload: { releaseNumber: release.number, fork: { ownerHandle: forker!.handle, slug: input.slug }, visibility },
      });
    }
    await recordEvent(tx, { projectId, actorId: userId, kind: 'release_created', subjectId: created!.id, payload: { number: 1 } });
    return summarize(tx, projectId, 'owner', userId);
  });
}
