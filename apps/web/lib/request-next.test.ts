import type { ApprovalRules } from '@gigacad/core';
import { describe, expect, it } from 'vitest';
import { nextStep, type RequestView } from './request-next';

const rules: ApprovalRules = { requiredCount: 1, approverUserIds: [], approverRoles: ['maintainer'], allowSelfApproval: false, requireCleanRebuild: false };

/** A contributor's request with a current candidate, waiting for one maintainer, seen by its requester. */
const view: RequestView = {
  requesterHandle: 'cam',
  branchName: 'wheel',
  canDrive: true,
  isRequester: true,
  canChangeRules: false,
  ownerHandle: 'olive',
  mayApprove: false,
  approved: false,
  picksOk: true,
  changesMain: true,
  hasCandidate: true,
  upToDate: true,
  canRelease: false,
  blockers: [{ kind: 'needs_approvals', have: 0, need: 1 }],
  releaseNumber: 3,
  latestNumber: 2,
  rules,
  waitingOn: ['bea'],
  rebuild: null,
};

describe('the next step on a release request', () => {
  it('says whose approval is needed', () => {
    expect(nextStep(view)).toEqual({ text: 'Waiting for 1 approval from a maintainer (@bea).', tone: 'plain' });
  });

  it('asks an approver to approve first, and offers the one-step release only to someone who can release', () => {
    const approver = { ...view, isRequester: false, canDrive: false, mayApprove: true };
    expect(nextStep(approver).text).toBe('Review the picks and approve the candidate.');
    expect(nextStep({ ...approver, canDrive: true }).text).toBe('Your approval is the last one needed. Approve the candidate, or approve and release v3 in one step.');
    const rebuildToo = { ...approver, blockers: [...view.blockers, { kind: 'rebuild_missing' as const }] };
    expect(nextStep(rebuildToo).text).toBe('Review the picks and approve the candidate. It also needs a clean SolidWorks rebuild before it can be released.');
  });

  it('tells only the people who can release that it is ready', () => {
    const ready = { ...view, canRelease: true, blockers: [], waitingOn: [] };
    expect(nextStep(ready)).toEqual({ text: 'Ready to release v3.', tone: 'ready' });
    expect(nextStep({ ...ready, canDrive: false, isRequester: false })).toEqual({ text: 'Ready: @cam or a maintainer can release v3.', tone: 'plain' });
    expect(nextStep({ ...ready, rebuild: { status: 'failed', errors: 2, warnings: 0 } })).toEqual({ text: 'Ready to release v3, but the last SolidWorks rebuild failed (2 errors).', tone: 'caution' });
  });

  it('explains why no one can approve, once, with the way out for whoever can take it', () => {
    const stuck = { ...view, canChangeRules: true, waitingOn: [], blockers: [{ kind: 'not_enough_eligible_approvers' as const, eligible: 0, need: 1 }, { kind: 'needs_approvals' as const, have: 0, need: 1 }] };
    expect(nextStep(stuck)).toEqual({
      text: 'Only 0 of the 1 required approvers can approve this request. Self-approval is off, so you can’t approve your own request. Change who can approve in the approval rules.',
      tone: 'caution',
      rules: true,
    });
    expect(nextStep({ ...stuck, canChangeRules: false }).text).toContain('Ask @olive to change who can approve in the approval rules.');
  });

  it('offers to build a missing candidate, and says when there is nothing to release', () => {
    expect(nextStep({ ...view, hasCandidate: false })).toEqual({ text: 'Build the candidate from these picks.', tone: 'plain', build: true });
    expect(nextStep({ ...view, hasCandidate: false, canDrive: false, isRequester: false }).text).toBe('Waiting for @cam to build the candidate.');
    expect(nextStep({ ...view, changesMain: false }).text).toBe('Nothing to release: these picks leave main as it is. Take at least one branch change, or close this request.');
  });

  it('gives a failed rebuild a real way forward for the requester, and a status for everyone else', () => {
    const failed = { ...view, blockers: [{ kind: 'rebuild_failed' as const }], waitingOn: [], rebuild: { status: 'failed' as const, errors: 2, warnings: 0 } };
    expect(nextStep(failed)).toEqual({ text: 'The SolidWorks rebuild failed (2 errors). Change the picks, or close this request to unfreeze wheel, fix the files, and open a new one.', tone: 'caution' });
    expect(nextStep({ ...failed, canDrive: false, isRequester: false }).text).toBe('The last SolidWorks rebuild failed. Waiting for @cam.');
  });

  it('asks for regenerating when main moved on', () => {
    expect(nextStep({ ...view, upToDate: false }).text).toBe('Main has a newer release (v2). Regenerate the candidate to include it.');
  });
});
