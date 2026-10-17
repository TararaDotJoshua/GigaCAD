/**
 * What the viewer of a release request page is reviewing: a candidate, and its files' STEP and
 * STL exports as they were (when one last changed). Live updates bring any new candidate or
 * export onto the page, but approving and releasing stay on what was reviewed until the viewer
 * says they've looked. A candidate the viewer's own action built needs no second look, but only
 * that exact one: if the action fails, or someone else's candidate arrives meanwhile, it does.
 */

/** What the page shows. `exportsChangedAt` is when an export of a candidate file last changed (null: none). */
export interface Shown {
  readonly candidateId: string | null;
  readonly exportsChangedAt: string | null;
}

/** What the viewer's own action is expected to leave as the candidate. */
export type OwnChange =
  /** Nothing of the viewer's is in flight. */
  | null
  /** An action that changes the candidate is running. */
  | 'running'
  /** It finished and left this candidate (null: it left none, e.g. picks with errors). */
  | { readonly candidateId: string | null };

export interface Review {
  readonly reviewed: Shown;
  readonly own: OwnChange;
}

/** The result of the viewer's own action: `candidateManifestId` when it says what it left. */
export function settleOwnChange(result: { readonly error?: string; readonly message?: string; readonly candidateManifestId?: string | null }): OwnChange {
  if (result.candidateManifestId !== undefined) return { candidateId: result.candidateManifestId };
  // A failed action built nothing, so nothing that appears next is the viewer's.
  return null;
}

/** The review once the page shows `shown`: it moves only to the viewer's own result. */
export function reconcile(review: Review, shown: Shown): Review {
  if (review.own && review.own !== 'running' && review.own.candidateId === shown.candidateId) return { reviewed: shown, own: null };
  return review;
}

/** Whether the page shows something other than what's under review. Held while the viewer's own action runs. */
export const reviewChanged = (review: Review, shown: Shown) =>
  review.own !== 'running' && (shown.candidateId !== review.reviewed.candidateId || shown.exportsChangedAt !== review.reviewed.exportsChangedAt);

/** Whether only an export changed: the same candidate, with a STEP or STL swapped since it was reviewed. */
export const exportsMoved = (review: Review, shown: Shown) => shown.candidateId === review.reviewed.candidateId && shown.exportsChangedAt !== review.reviewed.exportsChangedAt;
