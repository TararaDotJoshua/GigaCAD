import type { ProjectRole } from '@gigacad/core';
import type { Db } from '../db.js';
import { forbidden, notFound } from '../errors.js';

export interface ProjectRow {
  readonly id: string;
  readonly ownerId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: 'public' | 'private';
  readonly license: string | null;
  readonly createdAt: Date;
}

export interface ProjectAccess {
  readonly project: ProjectRow;
  /** The caller's role, or null for a non-member reading a public project. */
  readonly role: ProjectRole | null;
}

const RANK: Record<ProjectRole, number> = { viewer: 0, contributor: 1, maintainer: 2, owner: 3 };

export function hasRole(role: ProjectRole | null, minimum: ProjectRole): boolean {
  return role !== null && RANK[role] >= RANK[minimum];
}

/** Loads a project the caller can read. Private projects look nonexistent to outsiders. */
export async function projectAccess(
  db: Db,
  projectId: string,
  userId: string | null,
  options: { lock?: boolean } = {},
): Promise<ProjectAccess> {
  const [row] = await db<(ProjectRow & { role: ProjectRole | null })[]>`
    select p.id, p.owner_id, p.slug, p.name, p.description, p.visibility, p.license, p.created_at, m.role
    from projects p
    left join project_members m on m.project_id = p.id and m.user_id = ${userId}
    where p.id = ${projectId} and p.deleted_at is null
    ${options.lock ? db`for update of p` : db``}
  `;
  if (!row || (row.role === null && row.visibility !== 'public')) throw notFound('Project');
  const { role, ...project } = row;
  return { project, role };
}

export async function requireProjectRole(
  db: Db,
  projectId: string,
  userId: string,
  minimum: ProjectRole,
  options: { lock?: boolean } = {},
): Promise<ProjectAccess> {
  const access = await projectAccess(db, projectId, userId, options);
  if (!hasRole(access.role, minimum)) throw forbidden(`This needs ${minimum} access to the project`);
  return access;
}

/**
 * Stand-ins for a lock's holder and computer, for people outside the project. Machine names
 * are often a person's name, and the holder's id is for members. Installed clients read a null
 * holder as "not checked out", so outsiders get these instead of nulls.
 */
export const HIDDEN_LOCK_HOLDER = '00000000-0000-0000-0000-000000000000';
export const HIDDEN_LOCK_MACHINE = 'another computer';

/** A branch lock as this viewer may see it: who holds it is public on a public project, but not which account id or computer. */
export function lockForViewer<T extends { readonly checkedOutBy: string | null; readonly checkedOutMachine: string | null }>(lock: T, role: ProjectRole | null): T {
  if (role !== null || lock.checkedOutBy === null) return lock;
  return { ...lock, checkedOutBy: HIDDEN_LOCK_HOLDER, checkedOutMachine: HIDDEN_LOCK_MACHINE };
}
