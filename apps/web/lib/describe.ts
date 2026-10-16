import type { ApprovalRules, CandidateError, CandidateWarning, ItemChange, PickRow, ProjectRole, ReleaseBlocker } from '@gigacad/core';
import type { Branch, Commit, Member, ProjectEvent, RebuildStatus, ReleaseRequestStatus } from './api';

/**
 * Every state has exactly one treatment (docs/design/README.md, "Color").
 * `signal` is for good or final states only; `caution` and `danger` for problems.
 */
export type Tone = 'signal' | 'open' | 'caution' | 'danger' | 'quiet';

export function branchTone(status: Branch['status']): Tone {
  return status === 'released' ? 'signal' : status === 'open' ? 'open' : status === 'frozen' ? 'caution' : 'quiet';
}

export const BRANCH_STATUS_LABEL: Record<Branch['status'], string> = {
  open: 'Open',
  frozen: 'Frozen for release',
  released: 'Released',
  archived: 'Archived',
};

export function requestTone(status: ReleaseRequestStatus): Tone {
  return status === 'released' ? 'signal' : status === 'closed' ? 'quiet' : 'open';
}

export const REQUEST_STATUS_LABEL: Record<ReleaseRequestStatus, string> = {
  open: 'Open',
  candidate: 'Candidate ready',
  released: 'Released',
  closed: 'Closed',
};

/**
 * One badge for a request, the same in the list and on its page. A candidate is only
 * "ready" while it is built on the latest main and its rebuild (when required) passed.
 */
export function requestBadge(
  request: { status: ReleaseRequestStatus; upToDate: boolean; rebuildStatus: RebuildStatus | null },
  requireCleanRebuild: boolean,
): { label: string; tone: Tone } {
  if (request.status !== 'candidate') return { label: REQUEST_STATUS_LABEL[request.status], tone: requestTone(request.status) };
  if (!request.upToDate) return { label: 'Needs regenerating', tone: 'caution' };
  if (request.rebuildStatus === 'failed') return { label: 'Rebuild failed', tone: 'danger' };
  if (requireCleanRebuild && !request.rebuildStatus) return { label: 'Waiting for rebuild', tone: 'open' };
  return { label: REQUEST_STATUS_LABEL.candidate, tone: 'open' };
}

export const REBUILD_STATUS_LABEL: Record<RebuildStatus, string> = {
  passed: 'Passed',
  passed_with_warnings: 'Passed with warnings',
  failed: 'Failed',
};

/** The note under a file in the pick table. */
export function rowNote(row: PickRow, latestReleaseNumber: number | null): { text: string; caution: boolean } {
  if (row.conflict) return { text: 'Changed on both sides', caution: true };
  if (row.branchChange) return { text: describeChange(row.branchChange, 'branch'), caution: false };
  if (row.mainChange) {
    const where = latestReleaseNumber ? `main in v${latestReleaseNumber}` : 'main';
    return { text: describeChange(row.mainChange, where), caution: false };
  }
  return { text: 'Unchanged', caution: false };
}

function describeChange(change: ItemChange, where: string): string {
  switch (change.kind) {
    case 'added':
      return `New on ${where}`;
    case 'deleted':
      return `Deleted on ${where}`;
    case 'modified':
      if (change.moved && change.contentChanged) return `Moved from ${change.before.path} and changed on ${where}`;
      if (change.moved) return `Moved from ${change.before.path} on ${where}`;
      return `Changed on ${where}`;
  }
}

/** A change between two snapshots, as a short verb for commit and history lists. */
export function changeVerb(change: ItemChange): string {
  if (change.kind === 'added') return 'Added';
  if (change.kind === 'deleted') return 'Deleted';
  if (change.moved && change.contentChanged) return `Moved from ${change.before.path} and edited`;
  return change.moved ? `Moved from ${change.before.path}` : 'Edited';
}

export function blockerText(blocker: ReleaseBlocker): string {
  switch (blocker.kind) {
    case 'needs_approvals':
      return `Needs ${blocker.need - blocker.have} more approval${blocker.need - blocker.have === 1 ? '' : 's'}.`;
    case 'not_enough_eligible_approvers':
      return `Only ${blocker.eligible} of the ${blocker.need} required approvers can approve this request.`;
    case 'rebuild_missing':
      return 'Needs a clean SolidWorks rebuild of this candidate.';
    case 'rebuild_stale':
      return 'The rebuild report is for an older candidate. It needs a new rebuild.';
    case 'rebuild_failed':
      return 'The SolidWorks rebuild of this candidate failed.';
  }
}

/** Who may approve under the rules, in words: "an owner, a maintainer or @kim". `handles` names people by user id. */
export function approverText(rules: ApprovalRules, handles: ReadonlyMap<string, string> = new Map()): string {
  const roles = rules.approverRoles.map((role) => `${role === 'owner' ? 'an' : 'a'} ${role}`);
  const named = rules.approverUserIds.map((id) => handles.get(id)).filter((handle): handle is string => Boolean(handle));
  const people = named.length === rules.approverUserIds.length ? named.map((handle) => `@${handle}`) : rules.approverUserIds.length ? ['someone named in the rules'] : [];
  const who = [...roles, ...people];
  return who.length === 0 ? 'no one' : who.length === 1 ? who[0]! : `${who.slice(0, -1).join(', ')} or ${who.at(-1)}`;
}

/** The approval rule in one line, for the top of the Approvals card. */
export function ruleSummary(rules: ApprovalRules, handles?: ReadonlyMap<string, string>): string {
  if (rules.requiredCount === 0) return 'No approval is needed to release.';
  const count = rules.requiredCount === 1 ? '1 approval' : `${rules.requiredCount} approvals`;
  return `Needs ${count} from ${approverText(rules, handles)}. ${rules.allowSelfApproval ? 'The requester can approve too.' : 'The requester can’t approve their own request.'}`;
}

/** A pick warning as a sentence, naming every file it is about. */
export function warningText(warning: CandidateWarning): string {
  switch (warning.kind) {
    case 'overwrites_main_change':
      return `${warning.path} takes the branch’s version over a newer change on main.`;
    case 'discards_branch_change':
      return `${warning.path} keeps main’s version, so the branch’s change to it is left out.`;
    case 'replacement_discards_branch_change':
      return `${warning.toPath} replaces ${warning.path}, so the branch’s edit to ${warning.path} is left out.`;
    case 'missing_reference':
      return `${warning.path} references ${warning.referencedPath}, which isn’t in the release.`;
    case 'mixed_sources':
      return `${warning.path} comes from the branch but references ${warning.referencedPath}, which keeps main’s version.`;
    case 'needs_repoint':
      return `${warning.path} references ${warning.fromPath}, which ${warning.toPath} replaces. The SolidWorks rebuild must repoint it.`;
  }
}

/** A pick error as a sentence. `pathOf` names items by path where it can. */
export function errorText(error: CandidateError, pathOf: (itemId: string) => string | undefined): string {
  switch (error.kind) {
    case 'unknown_item':
      return `A saved pick names a file that isn’t in this request’s changes (${pathOf(error.itemId) ?? `item ${error.itemId.slice(0, 8)}`}). Save your picks to drop it.`;
    case 'invalid_replacement':
      return `${pathOf(error.branchItemId) ?? 'A new file'} can’t replace ${pathOf(error.mainItemId) ?? 'that main file'}: ${error.reason}.`;
    case 'path_collision':
      return `${error.itemIds.length} files would end up at ${error.path}. Keep only one of them.`;
  }
}

/** Members who may approve under the project's rules, in member order. */
export function eligibleApprovers(members: readonly Member[], rules: ApprovalRules, requesterId: string | null): Member[] {
  return members.filter(
    (member) =>
      (rules.approverUserIds.includes(member.userId) || rules.approverRoles.includes(member.role as ProjectRole)) &&
      (rules.allowSelfApproval || member.userId !== requesterId),
  );
}

export type TimelineEntry =
  | { readonly kind: 'version'; readonly commit: Commit }
  | { readonly kind: 'autosaves'; readonly commits: readonly Commit[] };

/** Newest first. Consecutive autosaves become one group, the way the drive shows unsaved work. */
export function groupTimeline(commits: readonly Commit[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const commit of commits) {
    const last = entries.at(-1);
    if (commit.kind === 'autosave') {
      if (last?.kind === 'autosaves') entries[entries.length - 1] = { kind: 'autosaves', commits: [...last.commits, commit] };
      else entries.push({ kind: 'autosaves', commits: [commit] });
    } else {
      entries.push({ kind: 'version', commit });
    }
  }
  return entries;
}

/** One plain sentence per project event for the activity list. Unknown kinds are skipped. */
export function describeEvent(
  event: ProjectEvent,
  names: { handle: (userId: string | null) => string; branch: (branchId: string | null) => string | undefined },
): string | undefined {
  const who = names.handle(event.actorId);
  const payload = event.payload ?? {};
  const branch = names.branch(event.subjectId);
  switch (event.kind) {
    case 'project_created':
      return `${who} created the project`;
    case 'project_restored':
      return `${who} restored the project`;
    case 'branch_created':
      return `${who} created branch ${String(payload.name)}`;
    case 'branch_checked_out':
      return `${who} checked out ${branch ?? 'a branch'}`;
    case 'branch_checked_in':
      return `${who} checked in ${branch ?? 'a branch'}`;
    case 'branch_lock_force_released':
      return `${who} force-released the lock on ${branch ?? 'a branch'}`;
    case 'branch_archived':
      return `${who} archived ${branch ?? 'a branch'}`;
    case 'commit_created':
      return payload.kind === 'version'
        ? `${who} committed ${payload.versionLabel ? `version ${String(payload.versionLabel)}` : 'a version'} on ${branch ?? 'a branch'}`
        : undefined;
    case 'release_request_opened':
      return `${who} opened release request #${String(payload.number)}`;
    case 'release_request_picks_changed':
      return `${who} changed the picks${request(payload)}, which resets its approvals`;
    case 'release_request_candidate_generated':
      return `${who} built the candidate${request(payload)}`;
    case 'release_request_candidate_updated': {
      const count = Number(payload.changedFiles ?? 0);
      return `${who} saved ${count === 1 ? 'a rebuilt file' : `${count} rebuilt files`} into the candidate${request(payload)}, which resets its approvals`;
    }
    case 'release_request_approved':
      return `${who} approved the candidate${request(payload)}`;
    case 'release_request_approval_withdrawn':
      return `${who} withdrew their approval${request(payload)}`;
    case 'release_request_rebuild_reported':
      return `${who} reported a ${String(payload.status).replace(/_/g, ' ')} rebuild${request(payload)}`;
    case 'release_request_closed':
      return `${who} closed ${payload.number ? `release request #${String(payload.number)}` : 'a release request'}`;
    case 'release_created':
      return `${who} released ${releaseName({ number: Number(payload.number), title: typeof payload.title === 'string' ? payload.title : null })}`;
    case 'export_attached':
    case 'export_replaced':
      return `${who} ${event.kind === 'export_replaced' ? 'replaced the' : 'attached a'} ${String(payload.format).toUpperCase()} export of ${String(payload.path ?? 'a SolidWorks file')}`;
    case 'member_changed':
      return payload.role ? `${who} made @${String(payload.handle)} a ${String(payload.role)}` : `${who} removed @${String(payload.handle)}`;
    case 'approval_rules_changed':
      return `${who} changed the approval rules`;
    case 'directory_entry_created':
      return `${who} added ${payload.kind === 'folder' ? 'folder ' : ''}${String(payload.path)}`;
    case 'root_file_replaced':
      return `${who} saved revision ${String(payload.revision)} of ${String(payload.path)}`;
    case 'directory_entry_moved':
      return `${who} ${parentOf(String(payload.from)) === parentOf(String(payload.to)) ? 'renamed' : 'moved'} ${String(payload.from)} to ${String(payload.to)}`;
    case 'directory_entry_deleted':
      return `${who} deleted ${String(payload.path)}`;
    case 'tag_created':
      return `${who} added the tag ${String(payload.name)}`;
    default:
      return undefined;
  }
}

/** " on release request #3", when the event says which. */
const request = (payload: Record<string, unknown>) => (payload.number ? ` on release request #${String(payload.number)}` : '');

const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

const BRANCH_WORK = new Set(['branch_checked_out', 'branch_checked_in', 'commit_created']);

/**
 * Folds a run of one person's checkouts, check-ins, and commits on one branch into a single
 * line, so a day of work reads as "committed 2 versions on longer-arms", not six events.
 * Entries are newest first, as the feed shows them; each run keeps its newest time.
 */
export function collapseActivity<T extends { event: ProjectEvent; text: string }>(
  entries: readonly T[],
  names: { handle: (userId: string | null) => string; branch: (branchId: string | null) => string | undefined },
): T[] {
  const out: T[] = [];
  let run: T[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const first = run[0]!;
    if (run.length === 1) out.push(first);
    else {
      const who = names.handle(first.event.actorId);
      const branch = names.branch(first.event.subjectId) ?? 'a branch';
      const versions = run.filter((entry) => entry.event.kind === 'commit_created' && entry.event.payload?.kind === 'version').length;
      const text = versions ? `${who} committed ${versions === 1 ? 'a version' : `${versions} versions`} on ${branch}` : `${who} worked on ${branch}`;
      out.push({ ...first, text });
    }
    run = [];
  };
  for (const entry of entries) {
    const head = run[0];
    const joins = BRANCH_WORK.has(entry.event.kind) && head && entry.event.actorId === head.event.actorId && entry.event.subjectId === head.event.subjectId;
    if (!joins) flush();
    if (BRANCH_WORK.has(entry.event.kind)) run.push(entry);
    else out.push(entry);
  }
  flush();
  return out;
}

/** A release's display name: its release request's title, or just its number. */
export function releaseName(release: { number: number; title?: string | null }): string {
  return release.title ? `v${release.number}: ${release.title}` : `v${release.number}`;
}
