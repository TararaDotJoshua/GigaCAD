import {
  approverIneligibility,
  buildCandidate,
  diffManifests,
  evaluateApprovals,
  type ApprovalEvaluation,
  type ApprovalRules,
  type Candidate,
  type CandidateInputs,
  type Manifest,
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
import { snapshotReleaseExports } from './exports.js';
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
  readonly rebuildReport: {
    messages: RebuildMessage[];
    /** Missing on reports from before 2026-10-16. */
    reportedBy?: { userId: string; handle: string | null };
    reportedAt?: string;
    via?: 'session' | 'device';
    deviceName?: string;
  } | null;
  readonly rebuildReportedAt: Date | null;
  readonly rebuildReportedBy: string | null;
  readonly releasedReleaseId: string | null;
  readonly reviewSnapshot: ReviewSnapshot | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The rules and their verdict when a request was released or closed. */
interface ReviewSnapshot {
  readonly rules: ApprovalRules;
  readonly evaluation: ApprovalEvaluation | null;
}

/** How many rebuild messages a request's detail carries; the rest come from `rebuildReportPage`. */
const REPORT_PREVIEW = 50;
const LEVEL_ORDER = { error: 0, warning: 1, info: 2 } as const;

/** A rebuild report as the request's detail shows it: counts by level and the most severe messages first. */
export interface RebuildReportSummary {
  readonly messages: RebuildMessage[];
  readonly total: number;
  readonly counts: { readonly error: number; readonly warning: number; readonly info: number };
  /** Who sent the report and when; missing on reports from before 2026-10-16. Outsiders get no user id. */
  readonly reportedBy?: { readonly userId?: string; readonly handle: string | null } | undefined;
  readonly reportedAt?: string | undefined;
  /** Where it came from: a website session, or a named desktop, add-in, or CLI sign-in. */
  readonly via?: 'session' | 'device' | undefined;
  readonly deviceName?: string | undefined;
}

/** A candidate file whose contents differ from what the picks built, because a SolidWorks rebuild saved it. */
export interface RebuiltFile {
  readonly itemId: string;
  readonly path: string;
  readonly blob: string;
  /** The contents the picks put there, or null if the picks didn't include the file. */
  readonly builtBlob: string | null;
}

interface ReleaseRef {
  readonly id: string;
  readonly number: number;
  readonly createdAt: Date;
  readonly createdByHandle: string | null;
}

export interface ReleaseRequestDetail {
  readonly releaseRequest: Omit<ReleaseRequestRow, 'rebuildReport' | 'reviewSnapshot'> & {
    readonly requesterHandle: string | null;
    readonly branchName: string;
    readonly rebuildReport: RebuildReportSummary | null;
    readonly rebuildReportedByHandle: string | null;
  };
  /** The branch as it is now, which can differ from what the request left it as once it is finished. */
  readonly branch: {
    readonly status: 'open' | 'frozen' | 'released' | 'archived';
    readonly activeRequestNumber: number | null;
    /** The release the branch started from. */
    readonly baseReleaseNumber: number | null;
  };
  readonly latestRelease: { readonly id: string; readonly number: number } | null;
  /** The main release the candidate was generated against. */
  readonly targetRelease: { readonly id: string; readonly number: number } | null;
  /** The release this request produced, once released. */
  readonly releasedRelease: ReleaseRef | null;
  /** The diff-pick result for the current picks: against the latest main while active, against the target main once finished. */
  readonly preview: Omit<Candidate, 'manifest'>;
  /** False when the picks leave main exactly as it is, so there is nothing to release. */
  readonly changesMain: boolean;
  readonly candidate: {
    readonly manifestId: string;
    readonly files: ManifestEntry[];
    /** False when main received a new release after this candidate was generated. */
    readonly upToDate: boolean;
    /** Files a SolidWorks rebuild saved after the candidate was built. They differ from the picked versions. */
    readonly rebuilt: RebuiltFile[];
  } | null;
  readonly approvals: {
    readonly given: readonly { readonly userId: string; readonly handle: string; readonly candidateManifestId: string; readonly createdAt: Date }[];
    readonly evaluation: ApprovalEvaluation | null;
    /** When an export of a candidate file last changed; approvals from before then no longer count. */
    readonly exportsChangedAt: Date | null;
    /**
     * The rules the evaluation used: today's while the request is active, the ones it finished
     * under after. Null for a request finished before those were recorded.
     */
    readonly rules: ApprovalRules | null;
  };
  readonly history: {
    /** Unsaved autosaves that opening the request saved as a version, and whose they were. */
    readonly snapshot: { readonly autosaves: number; readonly authorHandle: string | null } | null;
    /** The newest change to the candidate: what resets approvals and rebuild reports. */
    readonly lastCandidateChange: { readonly kind: 'picks_changed' | 'candidate_generated' | 'candidate_updated'; readonly actorHandle: string | null; readonly at: Date } | null;
    readonly closed: { readonly actorHandle: string | null; readonly at: Date } | null;
  };
}

async function loadRequest(db: Db, id: string, lock = false): Promise<ReleaseRequestRow> {
  const [row] = await db<ReleaseRequestRow[]>`
    select id, project_id, number, branch_id, requester_id, title, body, status, picks, target_release_id,
           candidate_manifest_id, rebuild_manifest_id, rebuild_status, rebuild_report, rebuild_reported_at,
           rebuild_reported_by, released_release_id, review_snapshot, created_at, updated_at
    from release_requests where id = ${id}
    ${lock ? db`for update` : db``}
  `;
  if (!row) throw notFound('Release request');
  return row;
}

async function releaseRef(db: Db, id: string | null): Promise<ReleaseRef | null> {
  if (!id) return null;
  const [release] = await db<ReleaseRef[]>`
    select r.id, r.number, r.created_at, p.handle as created_by_handle
    from releases r left join profiles p on p.id = r.created_by where r.id = ${id}
  `;
  return release ?? null;
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

/** Finished requests are a permanent record: nothing about them changes after release or close. */
async function requireActive(db: Db, request: ReleaseRequestRow): Promise<void> {
  if (request.status === 'open' || request.status === 'candidate') return;
  const released = await releaseRef(db, request.releasedReleaseId);
  throw conflict(
    'release_request_finished',
    released ? `This release request was already released as v${released.number}` : `This release request is ${request.status}`,
    { status: request.status, releaseNumber: released?.number ?? null },
  );
}

/**
 * The candidate a caller reviewed must still be the current one; otherwise they're acting on
 * something they haven't seen. Older clients name none and get the current candidate.
 */
function requireCandidate(request: ReleaseRequestRow, reviewed: string | undefined): string {
  if (request.status !== 'candidate' || !request.candidateManifestId) {
    throw conflict('no_candidate', 'There is no candidate yet. Build one from the picks first');
  }
  if (reviewed !== undefined && request.candidateManifestId !== reviewed) {
    throw conflict('stale_candidate', 'The candidate changed since you reviewed it; review it again', {
      candidateManifestId: request.candidateManifestId,
    });
  }
  return request.candidateManifestId;
}

/**
 * With `seen` (the exports version the reviewer was shown: when an export of a candidate file
 * last changed, or null for none), refuses an approval or release once that has changed, so a
 * swapped STEP or STL is never approved or released unseen. Installed clients send none.
 */
async function requireExportsSeen(db: Db, request: ReleaseRequestRow, seen: string | null | undefined): Promise<void> {
  if (seen === undefined) return;
  const changedAt = await exportsChangedAt(db, request);
  if ((changedAt?.getTime() ?? null) !== (seen === null ? null : new Date(seen).getTime())) {
    throw conflict('stale_candidate', 'An export of a file in the candidate changed since you reviewed it; review it again', {
      candidateManifestId: request.candidateManifestId,
      exportsChangedAt: changedAt,
    });
  }
}

/** True when a candidate would leave main exactly as the latest release has it. */
function leavesMainAsIs(candidate: Manifest, latestMain: Manifest): boolean {
  return diffManifests(latestMain, candidate).length === 0;
}

function summarizeReport(request: ReleaseRequestRow, reporterHandle: string | null): RebuildReportSummary | null {
  const report = request.rebuildReport;
  if (!report) return null;
  const counts = { error: 0, warning: 0, info: 0 };
  for (const message of report.messages) counts[message.level]++;
  const { messages, reportedBy, reportedAt, ...source } = report;
  return {
    ...source,
    // The reported-by columns are the record; reports stored before them carry it in the JSON only.
    reportedBy: request.rebuildReportedBy ? { userId: request.rebuildReportedBy, handle: reporterHandle } : reportedBy,
    reportedAt: request.rebuildReportedAt?.toISOString() ?? reportedAt,
    messages: sortedMessages(messages).slice(0, REPORT_PREVIEW),
    total: messages.length,
    counts,
  };
}

/** Errors first, then warnings, then notes, each in the order the rebuild reported them. */
function sortedMessages(messages: readonly RebuildMessage[]): RebuildMessage[] {
  return messages.map((message, index) => ({ message, index })).sort((a, b) => LEVEL_ORDER[a.message.level] - LEVEL_ORDER[b.message.level] || a.index - b.index).map(({ message }) => message);
}

/**
 * The inputs to the diff pick. An active request compares against the latest main. A finished
 * one compares against the main it was generated against (or its base, if it never had a
 * candidate), so its picks still read the way they did when it was released or closed.
 */
async function candidateInputs(db: Db, request: ReleaseRequestRow, against: 'latest' | 'target' = 'latest'): Promise<CandidateInputs> {
  const [branch] = await db<{ baseReleaseId: string | null; manifestId: string }[]>`
    select b.base_release_id, c.manifest_id
    from branches b join commits c on c.id = b.head_commit_id
    where b.id = ${request.branchId}
  `;
  if (!branch) throw notFound('Branch');
  const mainId = against === 'target' ? (request.targetReleaseId ?? branch.baseReleaseId) : ((await latestRelease(db, request.projectId))?.id ?? null);
  const [base, branchHead, latestMain] = await Promise.all([
    loadReleaseManifest(db, branch.baseReleaseId),
    loadManifest(db, branch.manifestId),
    loadReleaseManifest(db, mainId),
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

/**
 * When a STEP or STL export of a candidate file last changed. A release keeps the exports its
 * files have, so approvals given before an export changed don't cover what would be released.
 */
async function exportsChangedAt(db: Db, request: ReleaseRequestRow): Promise<Date | null> {
  if (!request.candidateManifestId) return null;
  const [row] = await db<{ changedAt: Date | null }[]>`
    select max(x.created_at) as changed_at from file_exports x
    where x.project_id = ${request.projectId}
      and x.source_sha256 in (select me.blob_sha256 from manifest_entries me where me.manifest_id = ${request.candidateManifestId})
  `;
  return row?.changedAt ?? null;
}

async function evaluate(db: Db, request: ReleaseRequestRow, rules: ApprovalRules): Promise<ApprovalEvaluation | null> {
  if (!request.candidateManifestId || !request.requesterId) return null;
  const [members, approvals, changedAt] = await Promise.all([
    db<{ userId: string; role: ProjectRole }[]>`select user_id, role from project_members where project_id = ${request.projectId}`,
    db<{ userId: string; candidateManifestId: string; createdAt: Date }[]>`
      select user_id, candidate_manifest_id, created_at from approvals where release_request_id = ${request.id}
    `,
    exportsChangedAt(db, request),
  ]);
  return evaluateApprovals({
    rules,
    requesterId: request.requesterId,
    memberRoles: new Map(members.map((member) => [member.userId, member.role])),
    candidateManifestId: request.candidateManifestId,
    // An approval from before an export changed is for something else than what would be released now.
    approvals: approvals.map(({ userId, candidateManifestId, createdAt }) => ({
      userId,
      candidateManifestId: changedAt && createdAt < changedAt ? `${candidateManifestId}:exports-changed` : candidateManifestId,
    })),
    rebuildReport:
      request.rebuildManifestId && request.rebuildStatus
        ? { candidateManifestId: request.rebuildManifestId, status: request.rebuildStatus }
        : undefined,
  });
}

export async function getReleaseRequest(sql: Sql, id: string, userId: string | null): Promise<ReleaseRequestDetail> {
  const request = await loadRequest(sql, id);
  const { role } = await projectAccess(sql, request.projectId, userId);
  const result = await detail(sql, request);
  return role === null ? forOutsiders(result) : result;
}

/**
 * What people outside the project see of a request: no member ids for the people the rules
 * name (as on /approval-rules), who asked, approved or filed the rebuild report, and no device
 * names, which carry the reporter's computer name. Approvers keep their handles, and their ids
 * become stand-ins that are the same throughout one response, so the page can still tell
 * whose approval counts.
 */
function forOutsiders(result: ReleaseRequestDetail): ReleaseRequestDetail {
  const { rules, given, evaluation } = result.approvals;
  const report = result.releaseRequest.rebuildReport;
  const { deviceName: _device, reportedBy, ...rest } = report ?? {};
  const standIns = new Map<string, string>();
  const standIn = (userId: string) => standIns.get(userId) ?? standIns.set(userId, `approver-${standIns.size + 1}`).get(userId)!;
  return {
    ...result,
    releaseRequest: {
      ...result.releaseRequest,
      requesterId: null,
      rebuildReportedBy: null,
      rebuildReport: report ? ({ ...rest, ...(reportedBy ? { reportedBy: { handle: reportedBy.handle } } : {}) } as RebuildReportSummary) : null,
    },
    approvals: {
      ...result.approvals,
      given: given.map((approval) => ({ ...approval, userId: standIn(approval.userId) })),
      evaluation: evaluation && {
        ...evaluation,
        countedUserIds: evaluation.countedUserIds.map(standIn),
        ignored: evaluation.ignored.map((ignored) => ({ ...ignored, userId: standIn(ignored.userId) })),
      },
      rules: rules ? { ...rules, approverUserIds: [] } : null,
    },
  };
}

async function detail(db: Db, request: ReleaseRequestRow): Promise<ReleaseRequestDetail> {
  const [names] = await db<{ requesterHandle: string | null; branchName: string; branchStatus: ReleaseRequestDetail['branch']['status']; baseNumber: number | null; baseReleaseId: string | null; reporterHandle: string | null }[]>`
    select p.handle as requester_handle, b.name as branch_name, b.status as branch_status, base.number as base_number, b.base_release_id, rp.handle as reporter_handle
    from branches b
    left join releases base on base.id = b.base_release_id
    left join profiles p on p.id = ${request.requesterId}
    left join profiles rp on rp.id = ${request.rebuildReportedBy}
    where b.id = ${request.branchId}
  `;
  const latest = await latestRelease(db, request.projectId);
  const active = request.status === 'open' || request.status === 'candidate';
  const inputs = await candidateInputs(db, request, active ? 'latest' : 'target');
  const { manifest: picked, ...preview } = buildCandidate(inputs);
  // A finished request without a candidate was compared against its branch's base, as in candidateInputs.
  const targetId = request.targetReleaseId ?? (active ? null : (names?.baseReleaseId ?? null));
  const [target, released] = await Promise.all([releaseRef(db, targetId), releaseRef(db, request.releasedReleaseId)]);

  const given = await db<{ userId: string; handle: string; candidateManifestId: string; createdAt: Date }[]>`
    select a.user_id, p.handle, a.candidate_manifest_id, a.created_at
    from approvals a join profiles p on p.id = a.user_id
    where a.release_request_id = ${request.id}
    order by a.created_at
  `;
  const [activeRequest] = await db<{ number: number }[]>`
    select number from release_requests where branch_id = ${request.branchId} and status in ('open', 'candidate')
  `;

  const { history, builtManifestId } = await requestHistory(db, request);
  let candidate: ReleaseRequestDetail['candidate'] = null;
  if (request.candidateManifestId) {
    const files = await loadManifest(db, request.candidateManifestId);
    const upToDate = request.status !== 'candidate' || request.targetReleaseId === (latest?.id ?? null);
    // Compare with the candidate as it was built from the picks, before any rebuild saved files
    // into it. That record doesn't move with the branch, which a closed request reopens.
    let rebuilt: RebuiltFile[] = [];
    if (builtManifestId && builtManifestId !== request.candidateManifestId) {
      const builtByItem = new Map((await loadManifest(db, builtManifestId)).map((entry) => [entry.itemId, entry.blob]));
      rebuilt = files
        .filter((file) => builtByItem.get(file.itemId) !== file.blob)
        .map((file) => ({ itemId: file.itemId, path: file.path, blob: file.blob, builtBlob: builtByItem.get(file.itemId) ?? null }));
    }
    candidate = { manifestId: request.candidateManifestId, files, upToDate, rebuilt };
  }

  // A finished request keeps the rules and verdict it finished under. One finished before those
  // were recorded shows the approvals its candidate got, without judging them by today's rules.
  const snapshot = active ? null : request.reviewSnapshot;
  const rules = active ? await loadApprovalRules(db, request.projectId) : (snapshot?.rules ?? null);
  const evaluation = active ? await evaluate(db, request, rules!) : snapshot ? snapshot.evaluation : unjudged(request, given);
  const { rebuildReport: _report, reviewSnapshot: _snapshot, ...row } = request;

  return {
    releaseRequest: {
      ...row,
      requesterHandle: names?.requesterHandle ?? null,
      branchName: names?.branchName ?? '',
      rebuildReport: summarizeReport(request, names?.reporterHandle ?? null),
      rebuildReportedByHandle: names?.reporterHandle ?? null,
    },
    branch: { status: names?.branchStatus ?? 'archived', activeRequestNumber: activeRequest?.number ?? null, baseReleaseNumber: names?.baseNumber ?? null },
    latestRelease: latest ? { id: latest.id, number: latest.number } : null,
    targetRelease: target ? { id: target.id, number: target.number } : null,
    releasedRelease: released,
    preview,
    changesMain: !leavesMainAsIs(picked, inputs.latestMain),
    candidate,
    approvals: { given, evaluation, rules, exportsChangedAt: active ? await exportsChangedAt(db, request) : null },
    history,
  };
}

/** The approvals a finished request's candidate got, for requests finished before their review was recorded. */
function unjudged(request: ReleaseRequestRow, given: readonly { userId: string; candidateManifestId: string }[]): ApprovalEvaluation {
  const counted = given.filter((approval) => approval.candidateManifestId === request.candidateManifestId).map((approval) => approval.userId);
  return { canRelease: request.status === 'released', countedUserIds: counted, ignored: [], blockers: [] };
}

/**
 * What the event log says about a request: the snapshot made when it opened, the last change
 * to its candidate, who closed it, and the manifest its candidate was last built as.
 */
async function requestHistory(db: Db, request: ReleaseRequestRow): Promise<{ history: ReleaseRequestDetail['history']; builtManifestId: string | null }> {
  const events = await db<{ kind: string; payload: Record<string, unknown>; createdAt: Date; actorHandle: string | null }[]>`
    select e.kind, e.payload, e.created_at, p.handle as actor_handle
    from project_events e left join profiles p on p.id = e.actor_id
    where e.project_id = ${request.projectId} and e.subject_id = ${request.id}
      and e.kind in ('release_request_opened', 'release_request_picks_changed', 'release_request_candidate_generated',
                     'release_request_candidate_updated', 'release_request_closed')
    order by e.id desc
  `;
  const opened = events.find((event) => event.kind === 'release_request_opened');
  const saved = opened?.payload.snapshot as { autosaves?: number; authorId?: string | null } | undefined;
  let snapshot: ReleaseRequestDetail['history']['snapshot'] = null;
  if (saved?.autosaves) {
    const [author] = saved.authorId ? await db<{ handle: string }[]>`select handle from profiles where id = ${saved.authorId}` : [];
    snapshot = { autosaves: saved.autosaves, authorHandle: author?.handle ?? null };
  }
  const change = events.find((event) => event.kind !== 'release_request_opened' && event.kind !== 'release_request_closed');
  const closed = events.find((event) => event.kind === 'release_request_closed');
  const generated = events.find((event) => event.kind === 'release_request_candidate_generated');
  return {
    history: {
      snapshot,
      lastCandidateChange: change
        ? { kind: change.kind.replace('release_request_', '') as 'picks_changed' | 'candidate_generated' | 'candidate_updated', actorHandle: change.actorHandle, at: change.createdAt }
        : null,
      closed: closed ? { actorHandle: closed.actorHandle, at: closed.createdAt } : null,
    },
    builtManifestId: typeof generated?.payload.manifestId === 'string' ? generated.payload.manifestId : null,
  };
}

/** A rebuild report's messages, most severe first, a page at a time. */
export async function rebuildReportPage(sql: Sql, id: string, userId: string | null, page: { offset: number; limit: number }) {
  const request = await loadRequest(sql, id);
  await projectAccess(sql, request.projectId, userId);
  const messages = sortedMessages(request.rebuildReport?.messages ?? []);
  return {
    candidateManifestId: request.rebuildManifestId,
    status: request.rebuildStatus,
    total: messages.length,
    messages: messages.slice(page.offset, page.offset + page.limit),
  };
}

export async function listReleaseRequests(sql: Sql, projectId: string, userId: string | null) {
  await projectAccess(sql, projectId, userId);
  return sql<
    {
      id: string;
      number: number;
      title: string;
      status: ReleaseRequestStatus;
      branchName: string;
      requesterHandle: string | null;
      updatedAt: Date;
      candidateManifestId: string | null;
      /** False when main has a newer release than the candidate was built on. */
      upToDate: boolean;
      /** The rebuild report's verdict on the current candidate, if there is one. */
      rebuildStatus: RebuildStatus | null;
    }[]
  >`
    select r.id, r.number, r.title, r.status, b.name as branch_name, p.handle as requester_handle, r.updated_at,
           r.candidate_manifest_id,
           (r.status <> 'candidate' or r.target_release_id is not distinct from (
             select l.id from releases l where l.project_id = r.project_id order by l.number desc limit 1
           )) as up_to_date,
           case when r.rebuild_manifest_id = r.candidate_manifest_id then r.rebuild_status end as rebuild_status
    from release_requests r
    join branches b on b.id = r.branch_id
    left join profiles p on p.id = r.requester_id
    where r.project_id = ${projectId}
    order by r.number desc
  `;
}


/**
 * Opens a release request. The branch freezes (checked in and read-only) until the
 * request is released or closed. Pending autosaves are kept by snapshotting them as a
 * version, credited to whoever made them. The first candidate is built from the default
 * picks right away, so every client lands on the same next step.
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
    const [head] = await tx<{ kind: string; manifestId: string; authorId: string | null }[]>`
      select kind, manifest_id, author_id from commits where id = ${branch.headCommitId}
    `;
    let snapshot: { autosaves: number; authorId: string | null } | undefined;
    if (head?.kind === 'autosave') {
      const [{ autosaves } = { autosaves: 0 }] = await tx<{ autosaves: number }[]>`
        select count(*)::int as autosaves from commits
        where branch_id = ${branchId} and kind = 'autosave'
          and created_at > coalesce((select max(created_at) from commits where branch_id = ${branchId} and kind = 'version'), '-infinity')
      `;
      snapshot = { autosaves, authorId: head.authorId };
      const [saved] = await tx<{ id: string }[]>`
        insert into commits (branch_id, parent_id, manifest_id, kind, message, author_id)
        values (${branchId}, ${branch.headCommitId}, ${head.manifestId}, 'version',
                ${`Snapshot for release request #${number}`}, ${head.authorId ?? userId})
        returning id
      `;
      await tx`update branches set head_commit_id = ${saved!.id} where id = ${branchId}`;
      await pruneAutosaves(tx, branchId, saved!.id, 'version');
    }

    await clearCheckout(tx, branchId);
    await tx`update branches set status = 'frozen' where id = ${branchId}`;
    const [created] = await tx<{ id: string }[]>`
      insert into release_requests (project_id, number, branch_id, requester_id, title, body)
      values (${branch.projectId}, ${number}, ${branchId}, ${userId}, ${input.title}, ${input.body ?? ''})
      returning id
    `;
    await recordEvent(tx, {
      projectId: branch.projectId,
      actorId: userId,
      kind: 'release_request_opened',
      subjectId: created!.id,
      payload: { number, branchId, ...(snapshot ? { snapshot } : {}) },
    });

    const request = await loadRequest(tx, created!.id);
    const inputs = await candidateInputs(tx, request);
    const candidate = buildCandidate(inputs);
    if (candidate.ok && !leavesMainAsIs(candidate.manifest, inputs.latestMain)) await storeCandidate(tx, request, userId, candidate);
    return detail(tx, await loadRequest(tx, created!.id));
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
    await requireActive(tx, request);
    return run(tx, request, access);
  }) as Promise<T>;
}

/** Any change to the candidate makes its rebuild report stale, so it goes with it. */
const clearRebuild = (tx: Tx) =>
  tx`rebuild_manifest_id = null, rebuild_status = null, rebuild_report = null, rebuild_reported_at = null, rebuild_reported_by = null`;

/** Saving picks discards any generated candidate; approvals on it no longer count. */
export async function setPicks(sql: Sql, id: string, userId: string, picks: Picks): Promise<ReleaseRequestDetail> {
  return withDriver(sql, id, userId, async (tx, request) => {
    await tx`
      update release_requests set
        picks = ${tx.json(picks as postgres.JSONValue)}, status = 'open',
        candidate_manifest_id = null, target_release_id = null, ${clearRebuild(tx)},
        updated_at = now()
      where id = ${id}
    `;
    await recordEvent(tx, { projectId: request.projectId, actorId: userId, kind: 'release_request_picks_changed', subjectId: id, payload: { number: request.number } });
    return detail(tx, await loadRequest(tx, id));
  });
}

/** Writes a built candidate onto the request, replacing any earlier one and its rebuild report. */
async function storeCandidate(tx: Tx, request: ReleaseRequestRow, userId: string, candidate: Candidate): Promise<void> {
  const manifestId = await insertManifest(tx, request.projectId, candidate.manifest);
  const latest = await latestRelease(tx, request.projectId);
  await tx`
    update release_requests set
      status = 'candidate', candidate_manifest_id = ${manifestId}, target_release_id = ${latest?.id ?? null},
      ${clearRebuild(tx)}, updated_at = now()
    where id = ${request.id}
  `;
  await recordEvent(tx, {
    projectId: request.projectId,
    actorId: userId,
    kind: 'release_request_candidate_generated',
    subjectId: request.id,
    payload: { number: request.number, manifestId, warnings: candidate.warnings.length },
  });
}

export async function generateCandidate(sql: Sql, id: string, userId: string): Promise<ReleaseRequestDetail> {
  return withDriver(sql, id, userId, async (tx, request) => {
    const inputs = await candidateInputs(tx, request);
    const candidate = buildCandidate(inputs);
    if (!candidate.ok) {
      throw unprocessable('candidate_invalid', 'Fix the pick errors before generating a candidate', { errors: candidate.errors });
    }
    if (leavesMainAsIs(candidate.manifest, inputs.latestMain)) {
      throw conflict('no_changes', 'These picks leave main as it is, so there is nothing to release');
    }
    await storeCandidate(tx, request, userId, candidate);
    return detail(tx, await loadRequest(tx, id));
  });
}

/**
 * Stores the files the SolidWorks rebuild saved. Only file contents may change;
 * the candidate's files and paths stay exactly as picked. Files whose contents didn't
 * change are skipped, and a call that changes nothing leaves the candidate (and its
 * approvals and rebuild report) as they are.
 */
export async function updateCandidateFiles(
  sql: Sql,
  id: string,
  userId: string,
  input: { baseManifestId: string; files: readonly { itemId: string; blob: string }[] },
): Promise<ReleaseRequestDetail> {
  return withDriver(sql, id, userId, async (tx, request) => {
    if (request.status !== 'candidate' || !request.candidateManifestId) {
      throw conflict('no_candidate', 'There is no candidate yet. Build one from the picks first');
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

    const changed = input.files.filter((file) => byItem.get(file.itemId)!.blob !== file.blob);
    if (changed.length === 0) return detail(tx, request);

    const blobs = [...new Set(changed.map((file) => file.blob))];
    const present = await tx<{ sha256: string }[]>`
      select sha256 from project_blobs where project_id = ${request.projectId} and sha256 = any(${blobs}::text[])
    `;
    const presentSet = new Set(present.map((row) => row.sha256));
    const missing = blobs.filter((sha) => !presentSet.has(sha));
    if (missing.length > 0) throw unprocessable('missing_blobs', 'Upload these files first', { sha256s: missing });

    const updates = new Map(changed.map((file) => [file.itemId, file.blob]));
    const next = current.map((entry) => ({ ...entry, blob: updates.get(entry.itemId) ?? entry.blob }));
    const manifestId = await insertManifest(tx, request.projectId, next);
    await tx`
      update release_requests set candidate_manifest_id = ${manifestId}, ${clearRebuild(tx)}, updated_at = now()
      where id = ${id}
    `;
    await recordEvent(tx, {
      projectId: request.projectId,
      actorId: userId,
      kind: 'release_request_candidate_updated',
      subjectId: id,
      payload: { number: request.number, manifestId, changedFiles: changed.length, paths: changed.slice(0, 20).map((file) => byItem.get(file.itemId)!.path) },
    });
    return detail(tx, await loadRequest(tx, id));
  });
}

const SEVERITY: Record<RebuildStatus, number> = { passed: 0, passed_with_warnings: 1, failed: 2 };

/** A report can't claim a cleaner rebuild than its own messages describe. */
export function reportStatus(claimed: RebuildStatus, messages: readonly RebuildMessage[]): RebuildStatus {
  const implied: RebuildStatus = messages.some((message) => message.level === 'error')
    ? 'failed'
    : messages.some((message) => message.level === 'warning')
      ? 'passed_with_warnings'
      : 'passed';
  return SEVERITY[implied] > SEVERITY[claimed] ? implied : claimed;
}

/** Where a rebuild report came from, shown with it so approvers can tell the add-in from a hand-typed report. */
export interface RebuildSource {
  readonly via: 'session' | 'device';
  /** The name a desktop, add-in, or CLI sign-in gave itself. */
  readonly deviceName?: string | undefined;
}

export async function reportRebuild(
  sql: Sql,
  id: string,
  userId: string,
  input: { candidateManifestId: string; status: RebuildStatus; messages: readonly RebuildMessage[] },
  source: RebuildSource = { via: 'session' },
): Promise<ReleaseRequestDetail> {
  return withDriver(sql, id, userId, async (tx, request) => {
    if (request.status !== 'candidate') throw conflict('no_candidate', 'There is no candidate yet. Build one from the picks first');
    if (request.candidateManifestId !== input.candidateManifestId) {
      throw conflict('stale_candidate', 'This report is for an older candidate', { candidateManifestId: request.candidateManifestId });
    }
    const status = reportStatus(input.status, input.messages);
    const [reporter] = await tx<{ handle: string }[]>`select handle from profiles where id = ${userId}`;
    const report = {
      messages: input.messages,
      reportedBy: { userId, handle: reporter?.handle ?? null },
      reportedAt: new Date().toISOString(),
      via: source.via,
      ...(source.deviceName ? { deviceName: source.deviceName } : {}),
    };
    await tx`
      update release_requests set
        rebuild_manifest_id = ${input.candidateManifestId}, rebuild_status = ${status},
        rebuild_report = ${tx.json(report as unknown as postgres.JSONValue)},
        rebuild_reported_at = now(), rebuild_reported_by = ${userId}, updated_at = now()
      where id = ${id}
    `;
    await recordEvent(tx, {
      projectId: request.projectId,
      actorId: userId,
      kind: 'release_request_rebuild_reported',
      subjectId: id,
      payload: { number: request.number, status },
    });
    return detail(tx, await loadRequest(tx, id));
  });
}

/**
 * Approves the candidate the approver reviewed, which must still be the current one and
 * built on the latest main. The approval stops counting if the candidate changes.
 */
export async function approve(
  sql: Sql,
  id: string,
  userId: string,
  input: { candidateManifestId?: string | undefined; exportsChangedAt?: string | null | undefined },
): Promise<ReleaseRequestDetail> {
  return sql.begin(async (tx) => {
    const request = await loadRequest(tx, id, true);
    const { role } = await projectAccess(tx, request.projectId, userId);
    // Shares the project lock an export change holds (setFileExport), so this waits for a swap that
    // hasn't committed yet, and the exports check below sees it.
    await tx`select 1 from projects where id = ${request.projectId} for share`;
    await requireActive(tx, request);
    const manifestId = requireCandidate(request, input.candidateManifestId);
    await requireExportsSeen(tx, request, input.exportsChangedAt);
    const latest = await latestRelease(tx, request.projectId);
    if ((latest?.id ?? null) !== request.targetReleaseId) {
      throw conflict('main_moved', `Main is now at v${latest?.number}; the candidate needs regenerating before it can be approved`, {
        latestReleaseNumber: latest?.number ?? null,
      });
    }
    const rules = await loadApprovalRules(tx, request.projectId);
    const reason = approverIneligibility(rules, userId, role ?? undefined, request.requesterId ?? '');
    if (reason) throw forbidden("You can't approve this release request", { reason });

    const [[already], changedAt] = await Promise.all([
      tx<{ candidateManifestId: string; createdAt: Date }[]>`
        select candidate_manifest_id, created_at from approvals where release_request_id = ${id} and user_id = ${userId}
      `,
      exportsChangedAt(tx, request),
    ]);
    await tx`
      insert into approvals (release_request_id, user_id, candidate_manifest_id)
      values (${id}, ${userId}, ${manifestId})
      on conflict (release_request_id, user_id)
      do update set candidate_manifest_id = excluded.candidate_manifest_id, created_at = now()
    `;
    // Approving the same candidate twice changes nothing, so it isn't news twice. An approval
    // from before an export changed stopped counting, so giving it again is.
    const repeat = already?.candidateManifestId === manifestId && !(changedAt && already.createdAt < changedAt);
    if (!repeat) {
      await recordEvent(tx, {
        projectId: request.projectId,
        actorId: userId,
        kind: 'release_request_approved',
        subjectId: id,
        payload: { number: request.number, candidateManifestId: manifestId },
      });
    }
    return detail(tx, await loadRequest(tx, id));
  });
}

export async function withdrawApproval(sql: Sql, id: string, userId: string): Promise<ReleaseRequestDetail> {
  return sql.begin(async (tx) => {
    const request = await loadRequest(tx, id, true);
    const { role } = await projectAccess(tx, request.projectId, userId);
    await requireActive(tx, request);
    const removed = await tx`delete from approvals where release_request_id = ${id} and user_id = ${userId}`;
    if (removed.count > 0) {
      await recordEvent(tx, { projectId: request.projectId, actorId: userId, kind: 'release_request_approval_withdrawn', subjectId: id, payload: { number: request.number } });
    }
    // Anyone signed in can call this on a public project; outsiders get what getReleaseRequest gives them.
    const result = await detail(tx, await loadRequest(tx, id));
    return role === null ? forOutsiders(result) : result;
  });
}

/** Keeps the rules and their verdict on a request as it finishes, so its record never changes. */
async function freezeReview(tx: Tx, request: ReleaseRequestRow, rules: ApprovalRules, evaluation: ApprovalEvaluation | null): Promise<void> {
  const snapshot: ReviewSnapshot = { rules, evaluation };
  await tx`update release_requests set review_snapshot = ${tx.json(snapshot as unknown as postgres.JSONValue)} where id = ${request.id}`;
}

/**
 * Writes the candidate the releaser reviewed as the next permanently locked release on
 * main, with the STEP and STL exports its files have now.
 */
export async function release(
  sql: Sql,
  id: string,
  userId: string,
  input: { candidateManifestId?: string | undefined; exportsChangedAt?: string | null | undefined; notes?: string | undefined },
): Promise<{ release: { id: string; number: number }; releaseRequest: ReleaseRequestDetail }> {
  return sql.begin(async (tx) => {
    const request = await loadRequest(tx, id, true);
    // Locking the project serializes releases, so release numbers never race.
    const access = await requireProjectRole(tx, request.projectId, userId, 'contributor', { lock: true });
    requireDriver(access, request, userId);
    await requireActive(tx, request);
    const manifestId = requireCandidate(request, input.candidateManifestId);
    await requireExportsSeen(tx, request, input.exportsChangedAt);

    const latest = await latestRelease(tx, request.projectId);
    if ((latest?.id ?? null) !== request.targetReleaseId) {
      throw conflict('main_moved', `Main is now at v${latest?.number}; regenerate the candidate to include it`, {
        latestReleaseNumber: latest?.number ?? null,
      });
    }
    if (leavesMainAsIs(await loadManifest(tx, manifestId), await loadReleaseManifest(tx, latest?.id ?? null))) {
      throw conflict('no_changes', 'This candidate leaves main as it is, so there is nothing to release');
    }
    const rules = await loadApprovalRules(tx, request.projectId);
    const evaluation = await evaluate(tx, request, rules);
    if (evaluation && !evaluation.canRelease) {
      throw conflict('approval_required', 'This release request is not ready to release yet', { blockers: evaluation.blockers });
    }

    const number = (latest?.number ?? 0) + 1;
    const [created] = await tx<{ id: string; number: number }[]>`
      insert into releases (project_id, number, manifest_id, release_request_id, notes, created_by)
      values (${request.projectId}, ${number}, ${manifestId}, ${id}, ${input.notes ?? ''}, ${userId})
      returning id, number
    `;
    await snapshotReleaseExports(tx, request.projectId, created!.id, manifestId);
    await tx`
      update release_requests set status = 'released', released_release_id = ${created!.id}, updated_at = now()
      where id = ${id}
    `;
    await freezeReview(tx, request, rules, evaluation);
    const branch = await lockBranch(tx, request.branchId);
    await tx`update branches set status = 'released' where id = ${request.branchId}`;
    await pruneAutosaves(tx, request.branchId, branch.headCommitId, 'release');

    await recordEvent(tx, {
      projectId: request.projectId,
      actorId: userId,
      kind: 'release_created',
      subjectId: created!.id,
      payload: { number, title: request.title, releaseRequestId: id, releaseRequestNumber: request.number },
    });
    return { release: created!, releaseRequest: await detail(tx, await loadRequest(tx, id)) };
  });
}

/** Closes the request without releasing; the branch unfreezes for more work. */
export async function closeReleaseRequest(sql: Sql, id: string, userId: string): Promise<ReleaseRequestDetail> {
  return withDriver(sql, id, userId, async (tx, request) => {
    await tx`update release_requests set status = 'closed', updated_at = now() where id = ${id}`;
    await tx`update branches set status = 'open' where id = ${request.branchId} and status = 'frozen'`;
    const rules = await loadApprovalRules(tx, request.projectId);
    await freezeReview(tx, request, rules, await evaluate(tx, request, rules));
    await recordEvent(tx, { projectId: request.projectId, actorId: userId, kind: 'release_request_closed', subjectId: id, payload: { number: request.number } });
    return detail(tx, await loadRequest(tx, id));
  });
}
