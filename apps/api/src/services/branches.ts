import { diffManifests, planAutosavePrune, type BranchCommit, type CommitKind, type ManifestEntry, type PruneTrigger } from '@gigacad/core';
import type { Db, Sql, Tx } from '../db.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { projectAccess, requireProjectRole } from './access.js';
import { recordEvent } from './events.js';
import { deleteUnreferencedManifests, insertManifest, loadManifest, resolveFiles, type FileInput } from './manifests.js';

export type BranchStatus = 'open' | 'frozen' | 'released' | 'archived';

export interface BranchView {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly status: BranchStatus;
  readonly baseReleaseId: string | null;
  readonly baseReleaseNumber: number | null;
  readonly headCommitId: string;
  readonly checkedOutBy: string | null;
  readonly checkedOutByHandle: string | null;
  readonly checkedOutMachine: string | null;
  readonly checkedOutAt: Date | null;
  readonly createdAt: Date;
}

export interface CommitView {
  readonly id: string;
  readonly branchId: string;
  readonly parentId: string | null;
  readonly manifestId: string;
  readonly kind: CommitKind;
  readonly message: string;
  readonly versionLabel: string | null;
  readonly authorId: string | null;
  readonly authorHandle: string | null;
  readonly createdAt: Date;
}

interface BranchRow {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly status: BranchStatus;
  readonly baseReleaseId: string | null;
  readonly headCommitId: string;
  readonly checkedOutBy: string | null;
  readonly checkedOutMachine: string | null;
}

export async function lockBranch(tx: Tx, branchId: string): Promise<BranchRow> {
  const [branch] = await tx<BranchRow[]>`
    select id, project_id, name, status, base_release_id, head_commit_id, checked_out_by, checked_out_machine
    from branches where id = ${branchId} for update
  `;
  if (!branch) throw notFound('Branch');
  return branch;
}

export async function branchView(db: Db, branchId: string): Promise<BranchView> {
  const [branch] = await db<BranchView[]>`
    select b.id, b.project_id, b.name, b.status, b.base_release_id, r.number as base_release_number,
           b.head_commit_id, b.checked_out_by, h.handle as checked_out_by_handle,
           b.checked_out_machine, b.checked_out_at, b.created_at
    from branches b
    left join releases r on r.id = b.base_release_id
    left join profiles h on h.id = b.checked_out_by
    where b.id = ${branchId}
  `;
  if (!branch) throw notFound('Branch');
  return branch;
}

async function commitView(db: Db, commitId: string): Promise<CommitView> {
  const [commit] = await db<CommitView[]>`
    select c.id, c.branch_id, c.parent_id, c.manifest_id, c.kind, c.message, c.version_label,
           c.author_id, a.handle as author_handle, c.created_at
    from commits c left join profiles a on a.id = c.author_id
    where c.id = ${commitId}
  `;
  if (!commit) throw notFound('Commit');
  return commit;
}

async function headManifestId(db: Db, headCommitId: string): Promise<string> {
  const [head] = await db<{ manifestId: string }[]>`select manifest_id from commits where id = ${headCommitId}`;
  if (!head) throw notFound('Commit');
  return head.manifestId;
}

export async function createBranch(
  sql: Sql,
  projectId: string,
  userId: string,
  input: { name: string; fromRelease?: number | undefined },
): Promise<BranchView> {
  return sql.begin(async (tx) => {
    await requireProjectRole(tx, projectId, userId, 'contributor');
    const [release] =
      input.fromRelease === undefined
        ? await tx<{ id: string; number: number; manifestId: string }[]>`
            select id, number, manifest_id from releases where project_id = ${projectId} order by number desc limit 1
          `
        : await tx<{ id: string; number: number; manifestId: string }[]>`
            select id, number, manifest_id from releases where project_id = ${projectId} and number = ${input.fromRelease}
          `;
    if (input.fromRelease !== undefined && !release) throw notFound(`Release v${input.fromRelease}`);

    const [existing] = await tx`select 1 from branches where project_id = ${projectId} and lower(name) = lower(${input.name})`;
    if (existing) throw conflict('branch_exists', `A branch named "${input.name}" already exists`);

    const manifestId = release?.manifestId ?? (await insertManifest(tx, projectId, []));
    const [branch] = await tx<{ id: string }[]>`
      insert into branches (project_id, name, base_release_id, created_by)
      values (${projectId}, ${input.name}, ${release?.id ?? null}, ${userId})
      returning id
    `;
    const branchId = branch!.id;
    const [commit] = await tx<{ id: string }[]>`
      insert into commits (branch_id, manifest_id, kind, message, author_id)
      values (${branchId}, ${manifestId}, 'version', ${release ? `Branched from v${release.number}` : 'New branch'}, ${userId})
      returning id
    `;
    await tx`update branches set head_commit_id = ${commit!.id} where id = ${branchId}`;
    await recordEvent(tx, {
      projectId,
      actorId: userId,
      kind: 'branch_created',
      subjectId: branchId,
      payload: { name: input.name, baseReleaseNumber: release?.number ?? null },
    });
    return branchView(tx, branchId);
  });
}

export async function listBranches(sql: Sql, projectId: string, userId: string | null): Promise<BranchView[]> {
  await projectAccess(sql, projectId, userId);
  return sql<BranchView[]>`
    select b.id, b.project_id, b.name, b.status, b.base_release_id, r.number as base_release_number,
           b.head_commit_id, b.checked_out_by, h.handle as checked_out_by_handle,
           b.checked_out_machine, b.checked_out_at, b.created_at
    from branches b
    left join releases r on r.id = b.base_release_id
    left join profiles h on h.id = b.checked_out_by
    where b.project_id = ${projectId}
    order by b.created_at desc
  `;
}

export async function getBranch(
  sql: Sql,
  branchId: string,
  userId: string | null,
): Promise<{ branch: BranchView; head: CommitView; files: ManifestEntry[] }> {
  const branch = await branchView(sql, branchId);
  await projectAccess(sql, branch.projectId, userId);
  const head = await commitView(sql, branch.headCommitId);
  return { branch, head, files: await loadManifest(sql, head.manifestId) };
}

/** Takes the branch's exclusive write lock for this user and machine. Re-checking out the same machine is a no-op. */
export async function checkOut(sql: Sql, branchId: string, userId: string, machine: string): Promise<BranchView> {
  return sql.begin(async (tx) => {
    const branch = await lockBranch(tx, branchId);
    await requireProjectRole(tx, branch.projectId, userId, 'contributor');
    if (branch.status !== 'open') {
      throw conflict('branch_not_open', `This branch is ${branch.status} and can't be checked out`);
    }
    if (branch.checkedOutBy === userId && branch.checkedOutMachine === machine) return branchView(tx, branchId);
    if (branch.checkedOutBy !== null) {
      const holder = await branchView(tx, branchId);
      throw conflict('checked_out', `Checked out by @${holder.checkedOutByHandle} on ${holder.checkedOutMachine}`, {
        userId: holder.checkedOutBy,
        handle: holder.checkedOutByHandle,
        machine: holder.checkedOutMachine,
        since: holder.checkedOutAt,
      });
    }
    await tx`
      update branches set checked_out_by = ${userId}, checked_out_machine = ${machine}, checked_out_at = now()
      where id = ${branchId}
    `;
    await recordEvent(tx, { projectId: branch.projectId, actorId: userId, kind: 'branch_checked_out', subjectId: branchId, payload: { machine } });
    return branchView(tx, branchId);
  });
}

/** Releases your own lock, from any of your machines. */
export async function checkIn(sql: Sql, branchId: string, userId: string): Promise<BranchView> {
  return sql.begin(async (tx) => {
    const branch = await lockBranch(tx, branchId);
    await projectAccess(tx, branch.projectId, userId);
    if (branch.checkedOutBy === null) return branchView(tx, branchId);
    if (branch.checkedOutBy !== userId) throw forbidden('Someone else has this branch checked out');
    await clearCheckout(tx, branchId);
    await recordEvent(tx, { projectId: branch.projectId, actorId: userId, kind: 'branch_checked_in', subjectId: branchId });
    return branchView(tx, branchId);
  });
}

/** Maintainers can break a stale lock. The previous holder is recorded so they can be notified. */
export async function forceRelease(sql: Sql, branchId: string, userId: string): Promise<BranchView> {
  return sql.begin(async (tx) => {
    const branch = await lockBranch(tx, branchId);
    await requireProjectRole(tx, branch.projectId, userId, 'maintainer');
    if (branch.checkedOutBy === null) return branchView(tx, branchId);
    await clearCheckout(tx, branchId);
    await recordEvent(tx, {
      projectId: branch.projectId,
      actorId: userId,
      kind: 'branch_lock_force_released',
      subjectId: branchId,
      payload: { previousHolder: branch.checkedOutBy, machine: branch.checkedOutMachine },
    });
    return branchView(tx, branchId);
  });
}

export async function archiveBranch(sql: Sql, branchId: string, userId: string): Promise<BranchView> {
  return sql.begin(async (tx) => {
    const branch = await lockBranch(tx, branchId);
    await requireProjectRole(tx, branch.projectId, userId, 'maintainer');
    if (branch.status === 'frozen') throw conflict('branch_frozen', 'Close its release request before archiving this branch');
    await tx`
      update branches set status = 'archived', checked_out_by = null, checked_out_machine = null, checked_out_at = null
      where id = ${branchId}
    `;
    await recordEvent(tx, { projectId: branch.projectId, actorId: userId, kind: 'branch_archived', subjectId: branchId });
    return branchView(tx, branchId);
  });
}

export async function clearCheckout(tx: Tx, branchId: string): Promise<void> {
  await tx`
    update branches set checked_out_by = null, checked_out_machine = null, checked_out_at = null
    where id = ${branchId}
  `;
}

export interface CommitInput {
  readonly parentId: string;
  readonly machine: string;
  readonly kind: CommitKind;
  readonly message?: string | undefined;
  readonly versionLabel?: string | undefined;
  readonly files: readonly FileInput[];
}

/**
 * Records a snapshot of the branch. Only the lock holder can commit, and only on
 * top of the current head. A version commit deletes the autosaves before it.
 */
export async function createCommit(
  sql: Sql,
  branchId: string,
  userId: string,
  input: CommitInput,
): Promise<{ commit: CommitView; files: ManifestEntry[]; created: boolean }> {
  return sql.begin(async (tx) => {
    const branch = await lockBranch(tx, branchId);
    await requireProjectRole(tx, branch.projectId, userId, 'contributor');
    if (branch.status !== 'open') throw conflict('branch_not_open', `This branch is ${branch.status} and can't be changed`);
    if (branch.checkedOutBy !== userId || branch.checkedOutMachine !== input.machine) {
      throw conflict('not_checked_out', 'Check out this branch on this machine before saving to it');
    }
    if (branch.headCommitId !== input.parentId) {
      throw conflict('stale_head', 'The branch moved on; refresh and try again', { headCommitId: branch.headCommitId });
    }

    const previous = await loadManifest(tx, await headManifestId(tx, branch.headCommitId));
    const files = await resolveFiles(tx, branch.projectId, input.files, previous);
    if (input.kind === 'autosave' && diffManifests(previous, files).length === 0) {
      return { commit: await commitView(tx, branch.headCommitId), files: previous, created: false };
    }

    const manifestId = await insertManifest(tx, branch.projectId, files);
    const [commit] = await tx<{ id: string }[]>`
      insert into commits (branch_id, parent_id, manifest_id, kind, message, version_label, author_id)
      values (${branchId}, ${branch.headCommitId}, ${manifestId}, ${input.kind}, ${input.message ?? ''},
              ${input.versionLabel ?? null}, ${userId})
      returning id
    `;
    const commitId = commit!.id;
    await tx`update branches set head_commit_id = ${commitId} where id = ${branchId}`;
    if (input.kind === 'version') await pruneAutosaves(tx, branchId, commitId, 'version');

    await recordEvent(tx, {
      projectId: branch.projectId,
      actorId: userId,
      kind: 'commit_created',
      subjectId: branchId,
      payload: { commitId, kind: input.kind, versionLabel: input.versionLabel ?? null },
    });
    return { commit: await commitView(tx, commitId), files, created: true };
  });
}

/** Applies the core pruning plan: relink history, move the head if needed, delete autosaves and their manifests. */
export async function pruneAutosaves(tx: Tx, branchId: string, headId: string, trigger: PruneTrigger): Promise<string | null> {
  const history = await tx<BranchCommit[]>`select id, parent_id, kind from commits where branch_id = ${branchId}`;
  const plan = planAutosavePrune(history, headId, trigger);
  if (plan.deleteIds.length === 0) return plan.newHeadId;

  for (const { commitId, newParentId } of plan.reparent) {
    await tx`update commits set parent_id = ${newParentId} where id = ${commitId}`;
  }
  if (plan.newHeadId !== headId) await tx`update branches set head_commit_id = ${plan.newHeadId} where id = ${branchId}`;
  const deleted = await tx<{ manifestId: string }[]>`
    delete from commits where id = any(${[...plan.deleteIds]}::uuid[]) returning manifest_id
  `;
  await deleteUnreferencedManifests(tx, deleted.map((row) => row.manifestId));
  return plan.newHeadId;
}

export async function listCommits(sql: Sql, branchId: string, userId: string | null): Promise<CommitView[]> {
  const branch = await branchView(sql, branchId);
  await projectAccess(sql, branch.projectId, userId);
  return sql<CommitView[]>`
    select c.id, c.branch_id, c.parent_id, c.manifest_id, c.kind, c.message, c.version_label,
           c.author_id, a.handle as author_handle, c.created_at
    from commits c left join profiles a on a.id = c.author_id
    where c.branch_id = ${branchId}
    order by c.created_at desc, c.id
  `;
}

export async function getCommit(sql: Sql, commitId: string, userId: string | null): Promise<{ commit: CommitView; files: ManifestEntry[] }> {
  const commit = await commitView(sql, commitId);
  const branch = await branchView(sql, commit.branchId);
  await projectAccess(sql, branch.projectId, userId);
  return { commit, files: await loadManifest(sql, commit.manifestId) };
}
