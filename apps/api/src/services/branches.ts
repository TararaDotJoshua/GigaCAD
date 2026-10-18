import { diffManifests, planAutosavePrune, type BranchCommit, type CommitKind, type ManifestEntry, type ProjectRole, type PruneTrigger } from '@gigacad/core';
import type { Db, Sql, Tx } from '../db.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { lockForViewer, projectAccess, requireProjectRole } from './access.js';
import type { Mailer } from '../mail.js';
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
  /** Who archived it and when, while it's archived. */
  readonly archivedByHandle: string | null;
  readonly archivedAt: Date | null;
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
           b.checked_out_machine, b.checked_out_at, ah.handle as archived_by_handle, ae.created_at as archived_at, b.created_at
    from branches b
    left join releases r on r.id = b.base_release_id
    left join profiles h on h.id = b.checked_out_by
    left join lateral (
      select e.actor_id, e.created_at from project_events e
      where b.status = 'archived' and e.project_id = b.project_id and e.subject_id = b.id and e.kind = 'branch_archived'
      order by e.id desc limit 1
    ) ae on true
    left join profiles ah on ah.id = ae.actor_id
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

    const [existing] = await tx<{ name: string; status: BranchStatus }[]>`
      select name, status from branches where project_id = ${projectId} and lower(name) = lower(${input.name})
    `;
    if (existing?.status === 'archived') {
      throw conflict('branch_exists_archived', `An archived branch is already called ${existing.name}`, { name: existing.name });
    }
    if (existing) throw conflict('branch_exists', `A branch named "${existing.name}" already exists`, { name: existing.name, status: existing.status });

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

/** Outsiders see that a branch is locked or archived, but not by whom, as with the activity feed. */
function branchForViewer(branch: BranchView, role: ProjectRole | null): BranchView {
  const view = lockForViewer(branch, role);
  return role === null && view.archivedByHandle ? { ...view, archivedByHandle: null } : view;
}

export async function listBranches(sql: Sql, projectId: string, userId: string | null): Promise<BranchView[]> {
  const { role } = await projectAccess(sql, projectId, userId);
  const branches = await sql<BranchView[]>`
    select b.id, b.project_id, b.name, b.status, b.base_release_id, r.number as base_release_number,
           b.head_commit_id, b.checked_out_by, h.handle as checked_out_by_handle,
           b.checked_out_machine, b.checked_out_at, ah.handle as archived_by_handle, ae.created_at as archived_at, b.created_at
    from branches b
    left join releases r on r.id = b.base_release_id
    left join profiles h on h.id = b.checked_out_by
    left join lateral (
      select e.actor_id, e.created_at from project_events e
      where b.status = 'archived' and e.project_id = b.project_id and e.subject_id = b.id and e.kind = 'branch_archived'
      order by e.id desc limit 1
    ) ae on true
    left join profiles ah on ah.id = ae.actor_id
    where b.project_id = ${projectId}
    order by b.created_at desc
  `;
  return branches.map((branch) => branchForViewer(branch, role));
}

export async function getBranch(
  sql: Sql,
  branchId: string,
  userId: string | null,
): Promise<{ branch: BranchView; head: CommitView; files: ManifestEntry[] }> {
  const branch = await branchView(sql, branchId);
  const { role } = await projectAccess(sql, branch.projectId, userId);
  const head = await commitView(sql, branch.headCommitId);
  return { branch: branchForViewer(branch, role), head, files: await loadManifest(sql, head.manifestId) };
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

/** Why someone's lock was taken from them, which their notice explains. */
export type LockReleaseReason = 'force_released' | 'archived' | 'member_removed';

/** Someone whose lock was released by someone else, with what's needed to tell them. */
export interface LockReleaseNotice {
  readonly email: string | null;
  readonly reason: LockReleaseReason;
  readonly releasedBy: string;
  readonly branchName: string;
  readonly machine: string | null;
  readonly projectName: string;
  readonly ownerHandle: string;
  readonly slug: string;
  /** Unsaved autosaves left on the branch since its last version. */
  readonly autosaves: number;
}

/**
 * Takes a lock from its holder on someone else's say-so: clears it, logs who held it, and
 * returns what's needed to tell them. Their autosaves stay on the branch.
 */
async function releaseLockOf(tx: Tx, branch: BranchRow, actorId: string, reason: LockReleaseReason): Promise<LockReleaseNotice | null> {
  if (branch.checkedOutBy === null) return null;
  await clearCheckout(tx, branch.id);
  await recordEvent(tx, {
    projectId: branch.projectId,
    actorId,
    kind: 'branch_lock_force_released',
    subjectId: branch.id,
    payload: { previousHolder: branch.checkedOutBy, machine: branch.checkedOutMachine, reason },
  });
  // Taking back your own lock needs no notice.
  if (branch.checkedOutBy === actorId) return null;
  const [notice] = await tx<Omit<LockReleaseNotice, 'reason' | 'branchName' | 'machine'>[]>`
    select u.email, actor.handle as released_by, p.name as project_name, o.handle as owner_handle, p.slug,
      (select count(*)::int from commits c where c.branch_id = ${branch.id} and c.kind = 'autosave') as autosaves
    from projects p
    join profiles o on o.id = p.owner_id
    join profiles actor on actor.id = ${actorId}
    left join auth.users u on u.id = ${branch.checkedOutBy}
    where p.id = ${branch.projectId}
  `;
  if (!notice) return null;
  return { ...notice, reason, branchName: branch.name, machine: branch.checkedOutMachine };
}

/** Emails someone that their lock was released. A mail failure doesn't undo the change. */
export async function notifyLockReleased(mailer: Mailer, webOrigin: string, notice: LockReleaseNotice): Promise<void> {
  if (!notice.email) return;
  const where = `${notice.branchName} in ${notice.projectName}`;
  const what =
    notice.reason === 'archived'
      ? `@${notice.releasedBy} archived ${where}, which released your checkout${notice.machine ? ` on ${notice.machine}` : ''}. The branch is read-only now.`
      : notice.reason === 'member_removed'
        ? `@${notice.releasedBy} changed your access to ${notice.projectName}, which released your checkout of ${notice.branchName}${notice.machine ? ` on ${notice.machine}` : ''}.`
        : `@${notice.releasedBy} force-released your checkout of ${where}${notice.machine ? ` on ${notice.machine}` : ''}.`;
  const next =
    notice.reason === 'member_removed'
      ? 'You can no longer save to it. Anything you saved before stays with the project.'
      : notice.reason === 'archived'
        ? 'Anything you saved stays in its history. Ask a maintainer to restore the branch if you still need to work on it.'
        : 'Your saved work stays on the branch, but you can no longer save to it from that machine. Check it out again to keep working, once nobody else has it.';
  const autosaves = notice.autosaves > 0 ? `It still has ${notice.autosaves === 1 ? '1 autosave' : `${notice.autosaves} autosaves`} since its last version.` : '';
  await mailer.send({
    to: notice.email,
    subject: `Your checkout of ${notice.branchName} in ${notice.projectName} was released`,
    text: [
      what,
      '',
      [next, autosaves].filter(Boolean).join(' '),
      ...(notice.reason === 'member_removed' ? [] : ['', `${webOrigin}/${notice.ownerHandle}/${notice.slug}/branches/${encodeURIComponent(notice.branchName)}`]),
    ].join('\n'),
  });
}

/** Maintainers can break a stale lock. The previous holder is recorded and told. */
export async function forceRelease(sql: Sql, branchId: string, userId: string): Promise<{ branch: BranchView; notice: LockReleaseNotice | null }> {
  return sql.begin(async (tx) => {
    const branch = await lockBranch(tx, branchId);
    await requireProjectRole(tx, branch.projectId, userId, 'maintainer');
    const notice = await releaseLockOf(tx, branch, userId, 'force_released');
    return { branch: await branchView(tx, branchId), notice };
  });
}

/**
 * Makes an open branch read-only. A lock on it is released, logged, and its holder told;
 * their autosaves stay, so restoring the branch gets them back.
 */
export async function archiveBranch(sql: Sql, branchId: string, userId: string): Promise<{ branch: BranchView; notice: LockReleaseNotice | null }> {
  return sql.begin(async (tx) => {
    const branch = await lockBranch(tx, branchId);
    await requireProjectRole(tx, branch.projectId, userId, 'maintainer');
    if (branch.status === 'archived') return { branch: await branchView(tx, branchId), notice: null };
    if (branch.status === 'frozen') throw conflict('branch_frozen', 'Close its release request before archiving this branch');
    if (branch.status !== 'open') throw conflict('branch_not_open', `This branch is ${branch.status} and can't be archived`);
    const notice = await releaseLockOf(tx, branch, userId, 'archived');
    await tx`update branches set status = 'archived' where id = ${branchId}`;
    await recordEvent(tx, {
      projectId: branch.projectId,
      actorId: userId,
      kind: 'branch_archived',
      subjectId: branchId,
      // Outsiders can read this event (LiveRefresh needs it), so it names no one; the lock
      // release above records the holder where only members can see it.
      payload: { name: branch.name },
    });
    return { branch: await branchView(tx, branchId), notice };
  });
}

/** Brings an archived branch back as an open one, with its history and autosaves. */
export async function unarchiveBranch(sql: Sql, branchId: string, userId: string): Promise<BranchView> {
  return sql.begin(async (tx) => {
    const branch = await lockBranch(tx, branchId);
    await requireProjectRole(tx, branch.projectId, userId, 'maintainer');
    if (branch.status === 'open') return branchView(tx, branchId);
    if (branch.status !== 'archived') throw conflict('branch_not_archived', `This branch is ${branch.status}, not archived`);
    await tx`update branches set status = 'open' where id = ${branchId}`;
    await recordEvent(tx, { projectId: branch.projectId, actorId: userId, kind: 'branch_unarchived', subjectId: branchId, payload: { name: branch.name } });
    return branchView(tx, branchId);
  });
}

/**
 * Releases a person's locks in a project when they can no longer save to it (removed, or
 * made a viewer). Runs in the caller's transaction, so the change and the release are one.
 */
export async function releaseLocksOf(tx: Tx, projectId: string, holderId: string, actorId: string): Promise<LockReleaseNotice[]> {
  const held = await tx<BranchRow[]>`
    select id, project_id, name, status, base_release_id, head_commit_id, checked_out_by, checked_out_machine
    from branches where project_id = ${projectId} and checked_out_by = ${holderId}
    order by name for update
  `;
  const notices: LockReleaseNotice[] = [];
  for (const branch of held) {
    const notice = await releaseLockOf(tx, branch, actorId, 'member_removed');
    if (notice) notices.push(notice);
  }
  return notices;
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
