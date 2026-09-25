import type { ApprovalRules, ItemChange, PickRow, ProjectRole, ReleaseBlocker } from '@gigacad/core';
import type { Branch, Commit, Member, ProjectEvent, ReleaseRequestStatus } from './api';

/**
 * Every state has exactly one treatment (docs/DESIGN.md, "Product app").
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
      return `Needs ${blocker.need - blocker.have} more approval${blocker.need - blocker.have === 1 ? '' : 's'}`;
    case 'not_enough_eligible_approvers':
      return `Only ${blocker.eligible} of the ${blocker.need} required approvers are eligible. Change the approval rules in settings.`;
    case 'rebuild_missing':
      return 'Needs a clean rebuild of this candidate from the SolidWorks add-in';
    case 'rebuild_stale':
      return 'The rebuild report is for an older candidate';
    case 'rebuild_failed':
      return 'The rebuild failed. Fix the errors and rebuild again';
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
    case 'release_request_candidate_generated':
      return `${who} generated a candidate`;
    case 'release_request_approved':
      return `${who} approved a candidate`;
    case 'release_request_rebuild_reported':
      return `${who} reported a ${String(payload.status).replace(/_/g, ' ')} rebuild`;
    case 'release_request_closed':
      return `${who} closed a release request`;
    case 'release_created':
      return `${who} released v${String(payload.number)}`;
    case 'member_changed':
      return payload.role ? `${who} made @${String(payload.handle)} a ${String(payload.role)}` : `${who} removed @${String(payload.handle)}`;
    case 'approval_rules_changed':
      return `${who} changed the approval rules`;
    default:
      return undefined;
  }
}
