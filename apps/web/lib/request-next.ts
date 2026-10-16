import type { ApprovalRules, ReleaseBlocker } from '@gigacad/core';
import type { RebuildStatus } from './api';
import { approverText } from './describe';

/** What one viewer can do on an active release request, and the request's state. */
export interface RequestView {
  readonly requesterHandle: string | null;
  readonly branchName: string;
  /** The requester (while a contributor or above), an owner, or a maintainer. */
  readonly canDrive: boolean;
  readonly isRequester: boolean;
  readonly canManage: boolean;
  /** The rules let this viewer approve. */
  readonly mayApprove: boolean;
  /** This viewer's approval counts on the current candidate. */
  readonly approved: boolean;
  readonly picksOk: boolean;
  readonly changesMain: boolean;
  readonly hasCandidate: boolean;
  readonly upToDate: boolean;
  readonly canRelease: boolean;
  readonly blockers: readonly ReleaseBlocker[];
  readonly releaseNumber: number;
  readonly latestNumber: number | null;
  readonly rules: ApprovalRules;
  /** Handles by user id, to name the people the rules list. */
  readonly handles?: ReadonlyMap<string, string>;
  /** Handles of eligible approvers whose approval of the current candidate is still missing. */
  readonly waitingOn: readonly string[];
  /** The current candidate's rebuild report, if it has one. */
  readonly rebuild: { readonly status: RebuildStatus; readonly errors: number; readonly warnings: number } | null;
}

export interface NextStep {
  readonly text: string;
  readonly tone: 'plain' | 'ready' | 'caution';
  /** Offer Build candidate right in the banner. */
  readonly build?: boolean;
  /** Link to the project's approval rules. */
  readonly rules?: boolean;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The one sentence at the top of an active request: what happens next, said to this viewer.
 * It leads with the viewer's own part (approving, rebuilding) and names who else is needed.
 */
export function nextStep(view: RequestView): NextStep {
  const requester = view.requesterHandle ? `@${view.requesterHandle}` : 'the requester';
  const drivers = `${requester} or a maintainer`;
  const next = `v${view.releaseNumber}`;

  if (!view.picksOk) {
    return view.canDrive
      ? { text: 'Fix the pick errors below, then save your picks.', tone: 'caution' }
      : { text: `The picks have errors. Waiting for ${requester} to fix them.`, tone: 'plain' };
  }
  if (!view.changesMain) {
    return {
      text: `Nothing to release: these picks leave main as it is.${view.canDrive ? ' Take at least one branch change, or close this request.' : ''}`,
      tone: 'caution',
    };
  }
  if (!view.hasCandidate) {
    return view.canDrive ? { text: 'Build the candidate from these picks.', tone: 'plain', build: true } : { text: `Waiting for ${requester} to build the candidate.`, tone: 'plain' };
  }
  if (!view.upToDate) {
    const newer = view.latestNumber ? ` (v${view.latestNumber})` : '';
    return {
      text: `Main has a newer release${newer}. ${view.canDrive ? 'Regenerate the candidate to include it.' : `Waiting for ${requester} to regenerate the candidate.`}`,
      tone: 'caution',
    };
  }

  const rebuildNote =
    view.rebuild?.status === 'failed'
      ? `the last SolidWorks rebuild failed (${plural(view.rebuild.errors, 'error')})`
      : view.rebuild?.status === 'passed_with_warnings'
        ? `the last SolidWorks rebuild passed with ${plural(view.rebuild.warnings, 'warning')}`
        : null;
  if (view.canRelease) {
    if (view.canDrive) return rebuildNote ? { text: `Ready to release ${next}, but ${rebuildNote}.`, tone: 'caution' } : { text: `Ready to release ${next}.`, tone: 'ready' };
    return { text: `Ready: ${drivers} can release ${next}.${rebuildNote ? ` Note that ${rebuildNote}.` : ''}`, tone: 'plain' };
  }

  const short = view.blockers.find((blocker) => blocker.kind === 'not_enough_eligible_approvers');
  if (short && short.kind === 'not_enough_eligible_approvers') {
    const self = view.rules.allowSelfApproval ? '' : view.isRequester ? ' Self-approval is off, so you can’t approve your own request.' : ` Self-approval is off, so ${requester} can’t approve their own request.`;
    const fix = view.canManage ? ' Change who can approve in the approval rules.' : ' An owner or maintainer can change who approves in the approval rules.';
    return { text: `Only ${short.eligible} of the ${short.need} required approvers can approve this request.${self}${fix}`, tone: 'caution', rules: true };
  }

  const rebuild = view.blockers.find((blocker) => blocker.kind === 'rebuild_missing' || blocker.kind === 'rebuild_stale' || blocker.kind === 'rebuild_failed');
  const approvals = view.blockers.find((blocker) => blocker.kind === 'needs_approvals');
  const missing = approvals && approvals.kind === 'needs_approvals' ? approvals.need - approvals.have : 0;

  if (view.mayApprove && !view.approved && missing > 0) {
    if (view.canDrive && missing === 1 && !rebuild) {
      return { text: `Your approval is the last one needed. Approve the candidate, or approve and release ${next} in one step.`, tone: 'plain' };
    }
    return { text: `Review the picks and approve the candidate.${rebuild ? ' It also needs a clean SolidWorks rebuild before it can be released.' : ''}`, tone: 'plain' };
  }

  const waiting = missing
    ? `Waiting for ${plural(missing, 'approval')} from ${approverText(view.rules, view.handles)}${view.waitingOn.length ? ` (${view.waitingOn.map((handle) => `@${handle}`).join(', ')})` : ''}.`
    : null;
  let rebuildText: string | null = null;
  if (rebuild?.kind === 'rebuild_failed') {
    const errors = view.rebuild?.errors ? ` (${plural(view.rebuild.errors, 'error')})` : '';
    rebuildText = view.canDrive
      ? `The SolidWorks rebuild failed${errors}. Change the picks, or close this request to unfreeze ${view.branchName}, fix the files, and open a new one.`
      : `The last SolidWorks rebuild failed. Waiting for ${requester}.`;
  } else if (rebuild) {
    const stale = rebuild.kind === 'rebuild_stale' ? 'The rebuild report is for an older candidate. ' : '';
    rebuildText = view.canDrive
      ? `${stale}Rebuild this candidate in SolidWorks with the GigaCAD add-in, or attach a report with giga rr rebuild-report.`
      : `${stale}It needs a clean SolidWorks rebuild from ${requester}.`;
  }
  // The requester leads with the rebuild, their part; everyone else with the approvals.
  const parts = view.canDrive ? [rebuildText, waiting] : [waiting, rebuildText];
  const text = parts.filter(Boolean).join(' ');
  return { text: text || 'Waiting for the release rules to be met.', tone: rebuild?.kind === 'rebuild_failed' ? 'caution' : 'plain' };
}
