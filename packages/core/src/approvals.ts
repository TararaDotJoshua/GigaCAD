export type ProjectRole = 'owner' | 'maintainer' | 'contributor' | 'viewer';

export interface ApprovalRules {
  /** Approvals needed before a candidate can be released. 0 skips the approval step. */
  readonly requiredCount: number;
  readonly approverUserIds: readonly string[];
  readonly approverRoles: readonly ProjectRole[];
  readonly allowSelfApproval: boolean;
  /** Require a rebuild report without errors for the current candidate. */
  readonly requireCleanRebuild: boolean;
}

export type RebuildStatus = 'passed' | 'passed_with_warnings' | 'failed';

export interface RebuildReport {
  readonly candidateManifestId: string;
  readonly status: RebuildStatus;
}

/** An approval only counts for the exact candidate manifest it was given on. */
export interface Approval {
  readonly userId: string;
  readonly candidateManifestId: string;
}

export interface ApprovalState {
  readonly rules: ApprovalRules;
  readonly requesterId: string;
  readonly memberRoles: ReadonlyMap<string, ProjectRole>;
  readonly candidateManifestId: string;
  readonly approvals: readonly Approval[];
  readonly rebuildReport?: RebuildReport | undefined;
}

export type IgnoredApprovalReason = 'stale' | 'not_a_member' | 'not_an_approver' | 'self_approval' | 'duplicate';

export type ReleaseBlocker =
  | { readonly kind: 'needs_approvals'; readonly have: number; readonly need: number }
  | { readonly kind: 'not_enough_eligible_approvers'; readonly eligible: number; readonly need: number }
  | { readonly kind: 'rebuild_missing' }
  | { readonly kind: 'rebuild_stale' }
  | { readonly kind: 'rebuild_failed' };

export interface ApprovalEvaluation {
  readonly canRelease: boolean;
  readonly countedUserIds: readonly string[];
  readonly ignored: readonly { readonly userId: string; readonly reason: IgnoredApprovalReason }[];
  readonly blockers: readonly ReleaseBlocker[];
}

/** Why a user can't approve this request, or undefined if they can. */
export function approverIneligibility(
  rules: ApprovalRules,
  userId: string,
  role: ProjectRole | undefined,
  requesterId: string,
): Exclude<IgnoredApprovalReason, 'stale' | 'duplicate'> | undefined {
  if (role === undefined) return 'not_a_member';
  if (!rules.approverUserIds.includes(userId) && !rules.approverRoles.includes(role)) return 'not_an_approver';
  if (userId === requesterId && !rules.allowSelfApproval) return 'self_approval';
  return undefined;
}

export function evaluateApprovals(state: ApprovalState): ApprovalEvaluation {
  const { rules, requesterId, memberRoles, candidateManifestId } = state;
  if (!Number.isInteger(rules.requiredCount) || rules.requiredCount < 0) {
    throw new RangeError(`requiredCount must be a non-negative integer, got ${rules.requiredCount}`);
  }

  const counted: string[] = [];
  const ignored: { userId: string; reason: IgnoredApprovalReason }[] = [];
  for (const { userId, candidateManifestId: approvedManifestId } of state.approvals) {
    const reason =
      approvedManifestId !== candidateManifestId
        ? 'stale'
        : (approverIneligibility(rules, userId, memberRoles.get(userId), requesterId) ??
          (counted.includes(userId) ? 'duplicate' : undefined));
    if (reason) ignored.push({ userId, reason });
    else counted.push(userId);
  }

  const blockers: ReleaseBlocker[] = [];
  let eligible = 0;
  for (const [userId, role] of memberRoles) {
    if (!approverIneligibility(rules, userId, role, requesterId)) eligible++;
  }
  if (eligible < rules.requiredCount) {
    blockers.push({ kind: 'not_enough_eligible_approvers', eligible, need: rules.requiredCount });
  }
  if (counted.length < rules.requiredCount) {
    blockers.push({ kind: 'needs_approvals', have: counted.length, need: rules.requiredCount });
  }

  if (rules.requireCleanRebuild) {
    const report = state.rebuildReport;
    if (!report) blockers.push({ kind: 'rebuild_missing' });
    else if (report.candidateManifestId !== candidateManifestId) blockers.push({ kind: 'rebuild_stale' });
    else if (report.status === 'failed') blockers.push({ kind: 'rebuild_failed' });
  }

  return { canRelease: blockers.length === 0, countedUserIds: counted, ignored, blockers };
}
