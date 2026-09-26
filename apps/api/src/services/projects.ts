import type { ApprovalRules, ProjectRole } from '@gigacad/core';
import type { Db, Sql } from '../db.js';
import { badRequest, forbidden, notFound, unprocessable } from '../errors.js';
import { projectAccess, requireProjectRole, type ProjectRow } from './access.js';
import { recordEvent } from './events.js';

export interface ProjectSummary extends ProjectRow {
  readonly ownerHandle: string;
  readonly role: ProjectRole | null;
  readonly latestReleaseNumber: number | null;
  readonly starCount: number;
  /** Whether the viewer starred it; false when signed out. */
  readonly starred: boolean;
  readonly forkCount: number;
  /** The release this project was forked from, if it still exists and the viewer can see it. */
  readonly forkedFrom: { readonly ownerHandle: string; readonly slug: string; readonly releaseNumber: number } | null;
  /** A fork of a private project, which can't be made public. */
  readonly mustStayPrivate: boolean;
}

export async function summarize(db: Db, projectId: string, role: ProjectRole | null, viewerId: string | null): Promise<ProjectSummary> {
  const [row] = await db<(Omit<ProjectSummary, 'role' | 'forkedFrom'> & { forkOwner: string | null; forkSlug: string | null; forkNumber: number | null })[]>`
    select p.id, p.owner_id, p.slug, p.name, p.description, p.visibility, p.license, p.created_at, p.must_stay_private,
           o.handle as owner_handle,
           (select max(number) from releases r where r.project_id = p.id) as latest_release_number,
           (select count(*)::int from stars s where s.project_id = p.id) as star_count,
           exists (select 1 from stars s where s.project_id = p.id and s.user_id = ${viewerId}) as starred,
           (select count(*)::int from projects f join releases fr on fr.id = f.forked_from_release_id
             where fr.project_id = p.id and f.deleted_at is null and f.visibility = 'public') as fork_count,
           so.handle as fork_owner, sp.slug as fork_slug, sr.number as fork_number
    from projects p join profiles o on o.id = p.owner_id
    left join releases sr on sr.id = p.forked_from_release_id
    left join projects sp on sp.id = sr.project_id and sp.deleted_at is null
      and (sp.visibility = 'public' or exists (select 1 from project_members m where m.project_id = sp.id and m.user_id = ${viewerId}))
    left join profiles so on so.id = sp.owner_id
    where p.id = ${projectId}
  `;
  if (!row) throw notFound('Project');
  const { forkOwner, forkSlug, forkNumber, ...summary } = row;
  return {
    ...summary,
    role,
    forkedFrom: forkOwner && forkSlug && forkNumber ? { ownerHandle: forkOwner, slug: forkSlug, releaseNumber: forkNumber } : null,
  };
}

export async function createProject(
  sql: Sql,
  userId: string,
  input: { slug: string; name: string; description?: string | undefined; visibility?: 'public' | 'private' | undefined },
): Promise<ProjectSummary> {
  return sql.begin(async (tx) => {
    const [project] = await tx<{ id: string }[]>`
      insert into projects (owner_id, slug, name, description, visibility)
      values (${userId}, ${input.slug}, ${input.name}, ${input.description ?? ''}, ${input.visibility ?? 'private'})
      returning id
    `;
    const projectId = project!.id;
    await tx`insert into project_members (project_id, user_id, role) values (${projectId}, ${userId}, 'owner')`;
    await tx`insert into approval_rules (project_id) values (${projectId})`;
    await recordEvent(tx, { projectId, actorId: userId, kind: 'project_created', subjectId: projectId });
    return summarize(tx, projectId, 'owner', userId);
  });
}

export async function listMyProjects(sql: Sql, userId: string): Promise<ProjectSummary[]> {
  return sql<ProjectSummary[]>`
    select p.id, p.owner_id, p.slug, p.name, p.description, p.visibility, p.license, p.created_at,
           o.handle as owner_handle, m.role,
           (select max(number) from releases r where r.project_id = p.id) as latest_release_number
    from project_members m
    join projects p on p.id = m.project_id and p.deleted_at is null
    join profiles o on o.id = p.owner_id
    where m.user_id = ${userId}
    order by p.created_at desc
  `;
}

export async function getProject(sql: Sql, projectId: string, userId: string | null): Promise<ProjectSummary> {
  const { role } = await projectAccess(sql, projectId, userId);
  return summarize(sql, projectId, role, userId);
}

export async function findProject(sql: Sql, ownerHandle: string, slug: string, userId: string | null): Promise<ProjectSummary> {
  const [row] = await sql<{ id: string }[]>`
    select p.id from projects p join profiles o on o.id = p.owner_id
    where o.handle = ${ownerHandle} and p.slug = ${slug} and p.deleted_at is null
  `;
  if (!row) throw notFound('Project');
  return getProject(sql, row.id, userId);
}

export async function updateProject(
  sql: Sql,
  projectId: string,
  userId: string,
  changes: { name?: string | undefined; description?: string | undefined; visibility?: 'public' | 'private' | undefined; license?: string | null | undefined },
): Promise<ProjectSummary> {
  return sql.begin(async (tx) => {
    const { role } = await requireProjectRole(tx, projectId, userId, 'maintainer', { lock: true });
    const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    if (changes.visibility === 'public') {
      const [row] = await tx<{ mustStayPrivate: boolean }[]>`select must_stay_private from projects where id = ${projectId}`;
      if (row?.mustStayPrivate) throw forbidden('A fork of a private project must stay private');
    }
    if (Object.keys(defined).length > 0) {
      await tx`update projects set ${tx(defined)} where id = ${projectId}`;
      await recordEvent(tx, { projectId, actorId: userId, kind: 'project_updated', subjectId: projectId, payload: defined });
    }
    return summarize(tx, projectId, role, userId);
  });
}

export async function deleteProject(sql: Sql, projectId: string, userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await requireProjectRole(tx, projectId, userId, 'owner', { lock: true });
    // Soft delete; a purge job removes it for good after the 30-day grace period.
    await tx`update projects set deleted_at = now() where id = ${projectId}`;
    await recordEvent(tx, { projectId, actorId: userId, kind: 'project_deleted', subjectId: projectId });
  });
}

/** Matches the purge job's default (jobs.ts); the terms promise 30 days. */
export const RESTORE_DAYS = 30;

export interface DeletedProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly ownerHandle: string;
  readonly deletedAt: Date;
  /** When the purge job may remove it for good. */
  readonly purgeAt: Date;
}

/** The caller's own deleted projects that can still be restored, most recently deleted first. */
export async function listDeletedProjects(sql: Sql, userId: string): Promise<DeletedProject[]> {
  return sql<DeletedProject[]>`
    select p.id, p.slug, p.name, o.handle as owner_handle, p.deleted_at,
           p.deleted_at + make_interval(days => ${RESTORE_DAYS}) as purge_at
    from projects p join profiles o on o.id = p.owner_id
    where p.owner_id = ${userId} and p.deleted_at is not null
      and p.deleted_at > now() - make_interval(days => ${RESTORE_DAYS})
    order by p.deleted_at desc
  `;
}

export async function restoreProject(sql: Sql, projectId: string, userId: string): Promise<ProjectSummary> {
  return sql.begin(async (tx) => {
    // Locked so a restore and the purge job never both act on the same project.
    const [project] = await tx<{ ownerId: string; restorable: boolean }[]>`
      select owner_id, deleted_at > now() - make_interval(days => ${RESTORE_DAYS}) as restorable
      from projects where id = ${projectId} and deleted_at is not null
      for update
    `;
    // Anyone but the owner sees no deleted project at all.
    if (!project || project.ownerId !== userId || !project.restorable) throw notFound('Deleted project');
    await tx`update projects set deleted_at = null where id = ${projectId}`;
    await recordEvent(tx, { projectId, actorId: userId, kind: 'project_restored', subjectId: projectId });
    return summarize(tx, projectId, 'owner', userId);
  });
}

export interface MemberView {
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string | null;
  readonly role: ProjectRole;
}

export async function listMembers(sql: Sql, projectId: string, userId: string | null): Promise<MemberView[]> {
  await projectAccess(sql, projectId, userId);
  return sql<MemberView[]>`
    select m.user_id, p.handle, p.display_name, m.role
    from project_members m join profiles p on p.id = m.user_id
    where m.project_id = ${projectId}
    order by array_position(array['owner','maintainer','contributor','viewer']::project_role[], m.role), p.handle
  `;
}

/** Owners manage everyone; maintainers manage contributors and viewers. The owner's own role is fixed. */
export async function setMember(sql: Sql, projectId: string, userId: string, handle: string, role: ProjectRole | null): Promise<void> {
  await sql.begin(async (tx) => {
    const { project, role: callerRole } = await requireProjectRole(tx, projectId, userId, 'maintainer', { lock: true });
    const [target] = await tx<{ id: string }[]>`select id from profiles where handle = ${handle}`;
    if (!target) throw notFound('User');
    if (target.id === project.ownerId) throw badRequest('owner_role_fixed', "The project owner's role can't be changed");
    if (role === 'owner') throw badRequest('single_owner', 'A project has exactly one owner');

    const [current] = await tx<{ role: ProjectRole }[]>`
      select role from project_members where project_id = ${projectId} and user_id = ${target.id}
    `;
    const touchesMaintainer = role === 'maintainer' || current?.role === 'maintainer';
    if (touchesMaintainer && callerRole !== 'owner') throw forbidden('Only the owner can add or remove maintainers');

    if (role === null) {
      await tx`delete from project_members where project_id = ${projectId} and user_id = ${target.id}`;
    } else {
      await tx`
        insert into project_members (project_id, user_id, role) values (${projectId}, ${target.id}, ${role})
        on conflict (project_id, user_id) do update set role = excluded.role
      `;
    }
    await recordEvent(tx, { projectId, actorId: userId, kind: 'member_changed', subjectId: target.id, payload: { handle, role } });
  });
}

export async function loadApprovalRules(db: Db, projectId: string): Promise<ApprovalRules> {
  const [rules] = await db<ApprovalRules[]>`
    select required_count, approver_user_ids::text[] as approver_user_ids, approver_roles::text[] as approver_roles,
           allow_self_approval, require_clean_rebuild
    from approval_rules where project_id = ${projectId}
  `;
  if (!rules) throw notFound('Approval rules');
  return rules;
}

export async function getApprovalRules(sql: Sql, projectId: string, userId: string | null): Promise<ApprovalRules> {
  await projectAccess(sql, projectId, userId);
  return loadApprovalRules(sql, projectId);
}

export async function setApprovalRules(sql: Sql, projectId: string, userId: string, rules: ApprovalRules): Promise<ApprovalRules> {
  return sql.begin(async (tx) => {
    await requireProjectRole(tx, projectId, userId, 'maintainer', { lock: true });
    if (rules.approverUserIds.length > 0) {
      const members = await tx<{ userId: string }[]>`
        select user_id from project_members
        where project_id = ${projectId} and user_id = any(${[...rules.approverUserIds]}::uuid[])
      `;
      const memberIds = new Set(members.map((m) => m.userId));
      const outsiders = rules.approverUserIds.filter((id) => !memberIds.has(id));
      if (outsiders.length > 0) throw unprocessable('approvers_not_members', 'Approvers must be project members', { userIds: outsiders });
    }
    await tx`
      update approval_rules set
        required_count = ${rules.requiredCount},
        approver_user_ids = ${[...rules.approverUserIds]}::uuid[],
        approver_roles = ${[...rules.approverRoles]}::project_role[],
        allow_self_approval = ${rules.allowSelfApproval},
        require_clean_rebuild = ${rules.requireCleanRebuild},
        updated_at = now()
      where project_id = ${projectId}
    `;
    await recordEvent(tx, { projectId, actorId: userId, kind: 'approval_rules_changed', payload: { ...rules } });
    return loadApprovalRules(tx, projectId);
  });
}

export async function listEvents(sql: Sql, projectId: string, userId: string | null, after: number, limit: number, order: 'asc' | 'desc' = 'asc') {
  await projectAccess(sql, projectId, userId);
  return sql<{ id: string; kind: string; actorId: string | null; subjectId: string | null; payload: unknown; createdAt: Date }[]>`
    select id::text, kind, actor_id, subject_id, payload, created_at
    from project_events where project_id = ${projectId} and id > ${after}
    order by id ${order === 'desc' ? sql`desc` : sql`asc`} limit ${limit}
  `;
}
