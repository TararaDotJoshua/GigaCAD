import {
  approverIneligibility,
  buildCandidate,
  evaluateApprovals,
  type ApprovalEvaluation,
  type Candidate,
  type CandidateInputs,
  type ManifestEntry,
  type Picks,
  type ProjectRole,
  type RebuildStatus,
} from '@gigacad/core';
import type postgres from 'postgres';
import type { Db, Sql, Tx } from '../db.js';
import { conflict, forbidden, notFound, unprocessable } from '../errors.js';
import { hasRole, projectAccess, requireProjectRole, type ProjectAccess } from './access.js';
import { clearCheckout, lockBranch, pruneAutosaves } from './branches.js';
import { recordEvent } from './events.js';
import { insertManifest, loadManifest, loadReleaseManifest } from './manifests.js';
import { loadApprovalRules } from './projects.js';

export type ReleaseRequestStatus = 'open' | 'candidate' | 'released' | 'closed';

export interface RebuildMessage {
  readonly level: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly path?: string | undefined;
}

interface ReleaseRequestRow {
  readonly id: string;
  readonly projectId: string;
  readonly number: number;
  readonly branchId: string;
  readonly requesterId: string | null;
  readonly title: string;
  readonly body: string;
  readonly status: ReleaseRequestStatus;
  readonly picks: Picks;
  readonly targetReleaseId: string | null;
  readonly candidateManifestId: string | null;
  readonly rebuildManifestId: string | null;
  readonly rebuildStatus: RebuildStatus | null;
  readonly rebuildReport: { messages: RebuildMessage[] } | null;
  readonly releasedReleaseId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ReleaseRequestDetail {
  readonly releaseRequest: ReleaseRequestRow & { readonly requesterHandle: string | null; readonly branchName: string };
  readonly latestRelease: { readonly id: string; readonly number: number } | null;
  /** The live diff-pick result for the current picks against the latest main release. */
  readonly preview: Omit<Candidate, 'manifest'>;
  readonly candidate: {
    readonly manifestId: string;
    readonly files: ManifestEntry[];
    /** False when main received a new release after this candidate was generated. */
    readonly upToDate: boolean;
  } | null;
  readonly approvals: {
    readonly given: readonly { readonly userId: string; readonly handle: string; readonly candidateManifestId: string; readonly createdAt: Date }[];
    readonly evaluation: ApprovalEvaluation | null;
  };
}

async function loadRequest(db: Db, id: string, lock = false): Promise<ReleaseRequestRow> {
  const [row] = await db<ReleaseRequestRow[]>`
    select id, project_id, number, branch_id, requester_id, title, body, status, picks, target_release_id,
           candidate_manifest_id, rebuild_manifest_id, rebuild_status, rebuild_report, released_release_id,
           created_at, updated_at
    from release_requests where id = ${id}
    ${lock ? db`for update` : db``}
  `;
  if (!row) throw notFound('Release request');
  return row;
}

async function latestRelease(db: Db, projectId: string): Promise<{ id: string; number: number } | null> {
  const [release] = await db<{ id: string; number: number }[]>`
    select id, number from releases where project_id = ${projectId} order by number desc limit 1
  `;
  return release ?? null;
}

/** The requester and maintainers drive a request; other contributors can only review it. */
function requireDriver(access: ProjectAccess, request: ReleaseRequestRow, userId: string): void {
  if (request.requesterId !== userId && !hasRole(access.role, 'maintainer')) {
    throw forbidden('Only the requester or a maintainer can change this release request');
  }
}

function requireActive(request: ReleaseRequestRow): void {
  if (request.status !== 'open' && request.status !== 'candidate') {
    throw conflict('release_request_finished', `This release request is ${request.status}`);
  }
}

async function candidateInputs(db: Db, request: ReleaseRequestRow): Promise<CandidateInputs> {
  const [branch] = await db<{ baseReleaseId: string | null; manifestId: string }[]>`
    select b.base_release_id, c.manifest_id
    from branches b join commits c on c.id = b.head_commit_id
    where b.id = ${request.branchId}
  `;
  if (!branch) throw notFound('Branch');
  const latest = await latestRelease(db, request.projectId);
  const [base, branchHead, latestMain] = await Promise.all([
    loadReleaseManifest(db, branch.baseReleaseId),
    loadManifest(db, branch.manifestId),
    loadReleaseManifest(db, latest?.id ?? null),
  ]);

  const blobs = [...new Set([...branchHead, ...latestMain].map((entry) => entry.blob))];
  const rows =
    blobs.length === 0
      ? []
      : await db<{ sha256: string; referencedPath: string }[]>`
          select sha256, referenced_path from blob_references
          where project_id = ${request.projectId} and sha256 = any(${blobs}::text[])
        `;
  const references = new Map<string, string[]>();
  for (const row of rows) references.set(row.sha256, [...(references.get(row.sha256) ?? []), row.referencedPath]);

  return { base, branchHead, latestMain, picks: request.picks, references };
}

async function evaluate(db: Db, request: ReleaseRequestRow): Promise<ApprovalEvaluation | null> {
  if (!request.candidateManifestId || !request.requesterId) return null;
  const [rules, members, approvals] = await Promise.all([
    loadApprovalRules(db, request.projectId),
    db<{ userId: string; role: ProjectRole }[]>`select user_id, role from project_members where project_id = ${request.projectId}`,
    db<{ userId: string; candidateManifestId: string }[]>`
      select user_id, candidate_manifest_id from approvals where release_request_id = ${request.id}
    `,
  ]);
  return evaluateApprovals({
    rules,
    requesterId: request.requesterId,
    memberRoles: new Map(members.map((member) => [member.userId, member.role])),
    candidateManifestId: request.candidateManifestId,
    approvals,
    rebuildReport:
      request.rebuildManifestId && request.rebuildStatus
        ? { candidateManifestId: request.rebuildManifestId, status: request.rebuildStatus }
        : undefined,
  });
}

export async function getReleaseRequest(sql: Sql, id: string, userId: string | null): Promise<ReleaseRequestDetail> {
  const request = await loadRequest(sql, id);
  await projectAccess(sql, request.projectId, userId);
  return detail(sql, request);
}

async function detail(db: Db, request: ReleaseRequestRow): Promise<ReleaseRequestDetail> {
  const [names] = await db<{ requesterHandle: string | null; branchName: string }[]>`
    select p.handle as requester_handle, b.name as branch_name
    from branches b left join profiles p on p.id = ${request.requesterId}
    where b.id = ${request.branchId}
  `;
  const latest = await latestRelease(db, request.projectId);
  const active = request.status === 'open' || request.status === 'candidate';
  const { manifest: _manifest, ...preview } = active
    ? buildCandidate(await candidateInputs(db, request))
    : { manifest: [], rows: [], replacements: [], warnings: [], errors: [], ok: true };

  const given = await db<{ userId: string; handle: string; candidateManifestId: string; createdAt: Date }[]>`
    select a.user_id, p.handle, a.candidate_manifest_id, a.created_at
    from approvals a join profiles p on p.id = a.user_id
    where a.release_request_id = ${request.id}
    order by a.created_at
  `;

  return {
    releaseRequest: { ...request, requesterHandle: names?.requesterHandle ?? null, branchName: names?.branchName ?? '' },
    latestRelease: latest,
    preview,
    candidate: request.candidateManifestId
      ? {
          manifestId: request.candidateManifestId,
          files: await loadManifest(db, request.candidateManifestId),
          upToDate: request.status !== 'candidate' || request.targetReleaseId === (latest?.id ?? null),
        }
      : null,
    approvals: { given, evaluation: active ? await evaluate(db, request) : null },
  };
}

export async function listReleaseRequests(sql: Sql, projectId: string, userId: string | null) {
  await projectAccess(sql, projectId, userId);
  return sql<{ id: string; number: number; title: string; status: ReleaseRequestStatus; branchName: string; requesterHandle: string | null; updatedAt: Date }[]>`
    select r.id, r.number, r.title, r.status, b.name as branch_name, p.handle as requester_handle, r.updated_at
    from release_requests r
    join branches b on b.id = r.branch_id
    left join profiles p on p.id = r.requester_id
    where r.project_id = ${projectId}
    order by r.number desc
  `;
}

/**
 * Opens a release request. The branch freezes (checked in and read-only) until the
 * request is released or closed. Pending autosaves are kept by snapshotting them as a version.
 */
export async function openReleaseRequest(
  sql: Sql,
  branchId: string,
  userId: string,
  input: { title: string; body?: string | undefined },
): Promise<ReleaseRequestDetail> {
  return sql.begin(async (tx) => {
    const branch = await lockBranch(tx, branchId);
    await requireProjectRole(tx, branch.projectId, userId, 'contributor', { lock: true });
    if (branch.status !== 'open') throw conflict('branch_not_open', `This branch is ${branch.status}`);
    if (branch.checkedOutBy !== null && branch.checkedOutBy !== userId) {
      throw conflict('checked_out', 'Someone else has this branch checked out; ask them to check it in first');
    }

    const [{ number } = { number: 1 }] = await tx<{ number: number }[]>`
      select coalesce(max(number), 0) + 1 as number from release_requests where project_id = ${branch.projectId}
    `;
    const [head] = await tx<{ kind: string; manifestId: string }[]>`
      select kind, manifest_id from commits where id = ${branch.headCommitId}
    `;
    if (head?.kind === 'autosave') {
      const [snapshot] = await tx<{ id: string }[]>`
        insert into commits (branch_id, parent_id, manifest_id, kind, message, author_id)
        values (${branchId}, ${branch.headCommitId}, ${head.manifestId}, 'version',
                ${`Snapshot for release request #${number}`}, ${userId})
        returning id
      `;
      await tx`update branches set head_commit_id = ${snapshot!.id} where id = ${branchId}`;
      await pruneAutosaves(tx, branchId, snapshot!.id, 'version');
    }

    await clearCheckout(tx, branchId);
    await tx`update branches set status = 'frozen' where id = ${branchId}`;
    const [request] = await tx<{ id: string }[]>`
      insert into release_requests (project_id, number, branch_id, requester_id, title, body)
      values (${branch.projectId}, ${number}, ${branchId}, ${userId}, ${input.title}, ${input.body ?? ''})
      returning id
    `;
    await recordEvent(tx, {
      projectId: branch.projectId,
      actorId: userId,
      kind: 'release_request_opened',
      subjectId: request!.id,
      payload: { number, branchId },
    });
    return detail(tx, await loadRequest(tx, request!.id));
  });
}

async function withDriver<T>(
  sql: Sql,
  id: string,
  userId: string,
  run: (tx: Tx, request: ReleaseRequestRow, access: ProjectAccess) => Promise<T>,
): Promise<T> {
  // postgres.js types begin() as unwrapping arrays; the callbacks here return plain objects.
  return sql.begin(async (tx) => {
    const request = await loadRequest(tx, id, true);
    const access = await requireProjectRole(tx, request.projectId, userId, 'contributor');
    requireDriver(access, request, userId);
    return run(tx, request, access);
  }) as Promise<T>;
}

/** Saving picks discards any generated candidate; approvals on it no longer count. */
export async function setPicks(sql: Sql, id: string, userId: string, picks: Picks): Promise<ReleaseRequestDetail> {
  return withDriver(sql, id, userId, async (tx, request) => {
    requireActive(request);
    await tx`
      update release_requests set
        picks = ${tx.json(picks as postgres.JSONValue)}, status = 'open',
        candidate_manifest_id = null, target_release_id = null,
        rebuild_manifest_id = null, rebuild_status = null, rebuild_report = null,
        updated_at = now()
      where id = ${id}
    `;
    await recordEvent(tx, { projectId: request.projectId, actorId: userId, kind: 'release_request_picks_changed', subjectId: id });
    return detail(tx, await loadRequest(tx, id));
  });
}

export async function generateCandidate(sql: Sql, id: string, userId: string): Promise<ReleaseRequestDetail> {
  return withDriver(sql, id, userId, async (tx, request) => {
    requireActive(request);
    const candidate = buildCandidate(await candidateInputs(tx, request));
    if (!candidate.ok) {
      throw unprocessable('candidate_invalid', 'Fix the pick errors before generating a candidate', { errors: candidate.errors });
    }
    const manifestId = await insertManifest(tx, request.projectId, candidate.manifest);
    const latest = await latestRelease(tx, request.projectId);
    await tx`
      update release_requests set
        status = 'candidate', candidate_manifest_id = ${manifestId}, target_release_id = ${latest?.id ?? null},
        rebuild_manifest_id = null, rebuild_status = null, rebuild_report = null, updated_at = now()
      where id = ${id}
    `;
    await recordEvent(tx, {
      projectId: request.projectId,
      actorId: userId,
      kind: 'release_request_candidate_generated',
      subjectId: id,
      payload: { manifestId, warnings: candidate.warnings.length },
    });
    return detail(tx, await loadRequest(tx, id));
  });
}

/**
 * Stores the files the SolidWorks rebuild saved. Only file contents may change;
 * the candidate's files and paths stay exactly as picked.
 */
export async function updateCandidateFiles(
  sql: Sql,
  id: string,
  userId: string,
  input: { baseManifestId: string; files: readonly { itemId: string; blob: string }[] },
): Promise<ReleaseRequestDetail> {
  return withDriver(sql, id, userId, async (tx, request) => {
    if (request.status !== 'candidate' || !request.candidateManifestId) {
      throw conflict('no_candidate', 'Generate a candidate first');
    }
    if (request.candidateManifestId !== input.baseManifestId) {
      throw conflict('stale_candidate', 'The candidate changed; refresh and rebuild again', {
        candidateManifestId: request.candidateManifestId,
      });
    }

    const current = await loadManifest(tx, request.candidateManifestId);
    const byItem = new Map(current.map((entry) => [entry.itemId, entry]));
    const unknown = input.files.filter((file) => !byItem.has(file.itemId)).map((file) => file.itemId);
    if (unknown.length > 0) throw unprocessable('unknown_items', 'Rebuilds can only update files already in the candidate', { itemIds: unknown });

    const blobs = [...new Set(input.files.map((file) => file.blob))];
    if (blobs.length > 0) {
      const present = await tx<{ sha256: string }[]>`
        select sha256 from project_blobs where project_id = ${request.projectId} and sha256 = any(${blobs}::text[])
      `;
      const presentSet = new Set(present.map((row) => row.sha256));
      const missing = blobs.filter((sha) => !presentSet.has(sha));
      if (missing.length > 0) throw unprocessable('missing_blobs', 'Upload these files first', { sha256s: missing });
    }

    const updates = new Map(input.files.map((file) => [file.itemId, file.blob]));
    const next = current.map((entry) => ({ ...entry, blob: updates.get(entry.itemId) ?? entry.blob }));
    const manifestId = await insertManifest(tx, request.projectId, next);
    await tx`
      update release_requests set
        candidate_manifest_id = ${manifestId},
        rebuild_manifest_id = null, rebuild_status = null, rebuild_report = null, updated_at = now()
      where id = ${id}
    `;
    await recordEvent(tx, {
      projectId: request.projectId,
      actorId: userId,
      kind: 'release_request_candidate_updated',
      subjectId: id,
      payload: { manifestId, changedFiles: input.files.length },
    });
    return detail(tx, await loadRequest(tx, id));
  });
}

export async function reportRebuild(
  sql: Sql,
  id: string,
  userId: string,
  input: { candidateManifestId: string; status: RebuildStatus; messages: readonly RebuildMessage[] },
): Promise<ReleaseRequestDetail> {
  return withDriver(sql, id, userId, async (tx, request) => {
    if (request.status !== 'candidate') throw conflict('no_candidate', 'Generate a candidate first');
    if (request.candidateManifestId !== input.candidateManifestId) {
      throw conflict('stale_candidate', 'This report is for an older candidate', { candidateManifestId: request.candidateManifestId });
    }
    await tx`
      update release_requests set
        rebuild_manifest_id = ${input.candidateManifestId}, rebuild_status = ${input.status},
        rebuild_report = ${tx.json({ messages: input.messages } as unknown as postgres.JSONValue)}, updated_at = now()
      where id = ${id}
    `;
    await recordEvent(tx, {
      projectId: request.projectId,
      actorId: userId,
      kind: 'release_request_rebuild_reported',
      subjectId: id,
      payload: { status: input.status },
    });
    return detail(tx, await loadRequest(tx, id));
  });
}

/** Approves the current candidate. The approval stops counting if the candidate changes. */
export async function approve(sql: Sql, id: string, userId: string): Promise<ReleaseRequestDetail> {
  return sql.begin(async (tx) => {
    const request = await loadRequest(tx, id, true);
    const { role } = await projectAccess(tx, request.projectId, userId);
    if (request.status !== 'candidate' || !request.candidateManifestId) {
      throw conflict('no_candidate', 'There is no candidate to approve yet');
    }
    const rules = await loadApprovalRules(tx, request.projectId);
    const reason = approverIneligibility(rules, userId, role ?? undefined, request.requesterId ?? '');
    if (reason) throw forbidden("You can't approve this release request", { reason });

    await tx`
      insert into approvals (release_request_id, user_id, candidate_manifest_id)
      values (${id}, ${userId}, ${request.candidateManifestId})
      on conflict (release_request_id, user_id)
      do update set candidate_manifest_id = excluded.candidate_manifest_id, created_at = now()
    `;
    await recordEvent(tx, {
      projectId: request.projectId,
      actorId: userId,
      kind: 'release_request_approved',
      subjectId: id,
      payload: { candidateManifestId: request.candidateManifestId },
    });
    return detail(tx, await loadRequest(tx, id));
  });
}

export async function withdrawApproval(sql: Sql, id: string, userId: string): Promise<ReleaseRequestDetail> {
  return sql.begin(async (tx) => {
    const request = await loadRequest(tx, id, true);
    await projectAccess(tx, request.projectId, userId);
    const removed = await tx`delete from approvals where release_request_id = ${id} and user_id = ${userId}`;
    if (removed.count > 0) {
      await recordEvent(tx, { projectId: request.projectId, actorId: userId, kind: 'release_request_approval_withdrawn', subjectId: id });
    }
    return detail(tx, await loadRequest(tx, id));
  });
}

/** Writes the candidate as the next permanently locked release on main. */
export async function release(
  sql: Sql,
  id: string,
  userId: string,
  input: { notes?: string | undefined },
): Promise<{ release: { id: string; number: number }; releaseRequest: ReleaseRequestDetail }> {
  return sql.begin(async (tx) => {
    const request = await loadRequest(tx, id, true);
    // Locking the project serializes releases, so release numbers never race.
    const access = await requireProjectRole(tx, request.projectId, userId, 'contributor', { lock: true });
    requireDriver(access, request, userId);
    if (request.status !== 'candidate' || !request.candidateManifestId) throw conflict('no_candidate', 'Generate a candidate first');

    const latest = await latestRelease(tx, request.projectId);
    if ((latest?.id ?? null) !== request.targetReleaseId) {
      throw conflict('main_moved', `Main is now at v${latest?.number}; regenerate the candidate to include it`, {
        latestReleaseNumber: latest?.number ?? null,
      });
    }
    const evaluation = await evaluate(tx, request);
    if (evaluation && !evaluation.canRelease) {
      throw conflict('approval_required', 'This release request is not approved yet', { blockers: evaluation.blockers });
    }

    const number = (latest?.number ?? 0) + 1;
    const [created] = await tx<{ id: string; number: number }[]>`
      insert into releases (project_id, number, manifest_id, release_request_id, notes, created_by)
      values (${request.projectId}, ${number}, ${request.candidateManifestId}, ${id}, ${input.notes ?? ''}, ${userId})
      returning id, number
    `;
    await tx`
      update release_requests set status = 'released', released_release_id = ${created!.id}, updated_at = now()
      where id = ${id}
    `;
    const branch = await lockBranch(tx, request.branchId);
    await tx`update branches set status = 'released' where id = ${request.branchId}`;
    await pruneAutosaves(tx, request.branchId, branch.headCommitId, 'release');

    await recordEvent(tx, {
      projectId: request.projectId,
      actorId: userId,
      kind: 'release_created',
      subjectId: created!.id,
      payload: { number, releaseRequestId: id, releaseRequestNumber: request.number },
    });
    return { release: created!, releaseRequest: await detail(tx, await loadRequest(tx, id)) };
  });
}

/** Closes the request without releasing; the branch unfreezes for more work. */
export async function closeReleaseRequest(sql: Sql, id: string, userId: string): Promise<ReleaseRequestDetail> {
  return withDriver(sql, id, userId, async (tx, request) => {
    requireActive(request);
    await tx`update release_requests set status = 'closed', updated_at = now() where id = ${id}`;
    await tx`update branches set status = 'open' where id = ${request.branchId} and status = 'frozen'`;
    await recordEvent(tx, { projectId: request.projectId, actorId: userId, kind: 'release_request_closed', subjectId: id });
    return detail(tx, await loadRequest(tx, id));
  });
}
