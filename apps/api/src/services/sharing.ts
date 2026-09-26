import { randomUUID } from 'node:crypto';
import type { Sql } from '../db.js';
import { forbidden, notFound, unprocessable } from '../errors.js';
import { projectAccess } from './access.js';
import { requireStorageFor } from './billing.js';
import { recordEvent } from './events.js';
import { insertManifest, loadManifest } from './manifests.js';
import { summarize, type ProjectSummary } from './projects.js';

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
    select p.id, o.handle as owner_handle, p.slug, p.name, p.description, p.visibility, p.license, p.created_at,
           (select max(number) from releases r where r.project_id = p.id) as latest_release_number,
           (select count(*)::int from stars s where s.project_id = p.id) as star_count
    from projects p join profiles o on o.id = p.owner_id
    where p.visibility = 'public' and p.deleted_at is null
      ${pattern ? sql`and (p.name ilike ${pattern} or p.slug ilike ${pattern} or p.description ilike ${pattern} or o.handle ilike ${pattern})` : sql``}
    order by ${query.sort === 'stars' ? sql`star_count desc, p.created_at desc` : sql`p.created_at desc`}
    limit ${query.limit} offset ${query.offset}
  `;
}

/** A user's public page: their profile and public projects, plus private ones when it's you. */
export async function userProfile(sql: Sql, handle: string, viewerId: string | null) {
  const [profile] = await sql<{ id: string; handle: string; displayName: string | null; createdAt: Date }[]>`
    select id, handle, display_name, created_at from profiles where handle = ${handle.toLowerCase()}
  `;
  if (!profile) throw notFound('User');
  const self = profile.id === viewerId;
  const projects = await sql<ProjectCard[]>`
    select p.id, ${profile.handle}::text as owner_handle, p.slug, p.name, p.description, p.visibility, p.license, p.created_at,
           (select max(number) from releases r where r.project_id = p.id) as latest_release_number,
           (select count(*)::int from stars s where s.project_id = p.id) as star_count
    from projects p
    where p.owner_id = ${profile.id} and p.deleted_at is null ${self ? sql`` : sql`and p.visibility = 'public'`}
    order by p.created_at desc
  `;
  const { id: _id, ...visible } = profile;
  return { profile: visible, projects };
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
  const { project: source } = await projectAccess(sql, sourceId, userId);
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
  const blobs = await sql<{ sha256: string; size: number }[]>`
    select sha256, size::float8 as size from blobs where sha256 = any(${[...new Set(entries.map((entry) => entry.blob))]}::text[])
  `;

  return sql.begin(async (tx) => {
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
    const manifestId = await insertManifest(tx, projectId, entries.map((entry, index) => ({ ...entry, itemId: itemIds[index]! })));
    const [created] = await tx<{ id: string }[]>`
      insert into releases (project_id, number, manifest_id, notes, created_by)
      values (${projectId}, 1, ${manifestId}, ${`Forked from @${owner!.handle}/${source.slug} v${release.number}.`}, ${userId})
      returning id
    `;
    await recordEvent(tx, { projectId, actorId: userId, kind: 'project_created', subjectId: projectId, payload: { forkedFrom: release.id } });
    await recordEvent(tx, { projectId, actorId: userId, kind: 'release_created', subjectId: created!.id, payload: { number: 1 } });
    return summarize(tx, projectId, 'owner', userId);
  });
}
