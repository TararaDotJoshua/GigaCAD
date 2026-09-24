import { describe, expect, it } from 'vitest';
import { evaluateApprovals, type ApprovalRules, type ApprovalState, type ProjectRole } from './approvals.js';

const rules: ApprovalRules = {
  requiredCount: 2,
  approverUserIds: ['carol'],
  approverRoles: ['maintainer'],
  allowSelfApproval: false,
  requireCleanRebuild: false,
};

const members = new Map<string, ProjectRole>([
  ['alex', 'maintainer'],
  ['bea', 'maintainer'],
  ['carol', 'contributor'],
  ['dan', 'contributor'],
]);

const state = (overrides: Partial<ApprovalState> = {}): ApprovalState => ({
  rules,
  requesterId: 'alex',
  memberRoles: members,
  candidateManifestId: 'm2',
  approvals: [],
  ...overrides,
});

describe('evaluateApprovals', () => {
  it('releases once enough eligible approvers sign off on the current candidate', () => {
    const result = evaluateApprovals(
      state({
        approvals: [
          { userId: 'bea', candidateManifestId: 'm2' },
          { userId: 'carol', candidateManifestId: 'm2' },
        ],
      }),
    );

    expect(result).toEqual({ canRelease: true, countedUserIds: ['bea', 'carol'], ignored: [], blockers: [] });
  });

  it('ignores stale, self, non-approver, non-member, and duplicate approvals', () => {
    const result = evaluateApprovals(
      state({
        approvals: [
          { userId: 'bea', candidateManifestId: 'm1' },
          { userId: 'alex', candidateManifestId: 'm2' },
          { userId: 'dan', candidateManifestId: 'm2' },
          { userId: 'eve', candidateManifestId: 'm2' },
          { userId: 'carol', candidateManifestId: 'm2' },
          { userId: 'carol', candidateManifestId: 'm2' },
        ],
      }),
    );

    expect(result.countedUserIds).toEqual(['carol']);
    expect(result.ignored).toEqual([
      { userId: 'bea', reason: 'stale' },
      { userId: 'alex', reason: 'self_approval' },
      { userId: 'dan', reason: 'not_an_approver' },
      { userId: 'eve', reason: 'not_a_member' },
      { userId: 'carol', reason: 'duplicate' },
    ]);
    expect(result.blockers).toEqual([{ kind: 'needs_approvals', have: 1, need: 2 }]);
  });

  it('lets a solo owner approve their own request when allowed', () => {
    const solo = evaluateApprovals({
      rules: { ...rules, requiredCount: 1, approverRoles: ['owner'], approverUserIds: [], allowSelfApproval: true },
      requesterId: 'me',
      memberRoles: new Map([['me', 'owner']]),
      candidateManifestId: 'm1',
      approvals: [{ userId: 'me', candidateManifestId: 'm1' }],
    });

    expect(solo.canRelease).toBe(true);
  });

  it('flags rules that no set of members can satisfy', () => {
    const result = evaluateApprovals(state({ rules: { ...rules, requiredCount: 3 } }));

    expect(result.blockers).toContainEqual({ kind: 'not_enough_eligible_approvers', eligible: 2, need: 3 });
  });

  it('allows releasing without approvals when none are required', () => {
    expect(evaluateApprovals(state({ rules: { ...rules, requiredCount: 0 } })).canRelease).toBe(true);
  });

  it.each([
    [undefined, 'rebuild_missing'],
    [{ candidateManifestId: 'm1', status: 'passed' as const }, 'rebuild_stale'],
    [{ candidateManifestId: 'm2', status: 'failed' as const }, 'rebuild_failed'],
  ])('requires a clean rebuild of the current candidate (%j)', (rebuildReport, blocker) => {
    const result = evaluateApprovals(
      state({ rules: { ...rules, requiredCount: 0, requireCleanRebuild: true }, rebuildReport }),
    );

    expect(result.blockers).toEqual([{ kind: blocker }]);
  });

  it('accepts a rebuild that passed with warnings', () => {
    const result = evaluateApprovals(
      state({
        rules: { ...rules, requiredCount: 0, requireCleanRebuild: true },
        rebuildReport: { candidateManifestId: 'm2', status: 'passed_with_warnings' },
      }),
    );

    expect(result.canRelease).toBe(true);
  });

  it('rejects invalid required counts', () => {
    expect(() => evaluateApprovals(state({ rules: { ...rules, requiredCount: -1 } }))).toThrow(RangeError);
  });
});
