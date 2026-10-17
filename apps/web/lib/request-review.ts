/**
 * Which candidate the viewer of a release request page is reviewing. Live updates bring any new
 * candidate onto the page, but approving and releasing stay on the reviewed one until the viewer
 * says they've looked. A candidate the viewer's own action built needs no second look, but only
 * that exact one: if the action fails, or someone else's candidate arrives meanwhile, it does.
 */

/** What the viewer's own action is expected to leave as the candidate. */
export type OwnChange =
  /** Nothing of the viewer's is in flight. */
  | null
  /** An action that changes the candidate is running. */
  | 'running'
  /** It finished and left this candidate (null: it left none, e.g. picks with errors). */
  | { readonly candidateId: string | null };

export interface Review {
  readonly reviewedId: string | null;
  readonly own: OwnChange;
}

/** The result of the viewer's own action: `candidateManifestId` when it says what it left. */
export function settleOwnChange(result: { readonly error?: string; readonly message?: string; readonly candidateManifestId?: string | null }): OwnChange {
  if (result.candidateManifestId !== undefined) return { candidateId: result.candidateManifestId };
  // A failed action built nothing, so nothing that appears next is the viewer's.
  return null;
}

/** The review after the page's candidate is `candidateId`: it moves only to the viewer's own result. */
export function reconcile(review: Review, candidateId: string | null): Review {
  if (review.own && review.own !== 'running' && review.own.candidateId === candidateId) return { reviewedId: candidateId, own: null };
  return review;
}

/** Whether the page shows a candidate other than the one under review. Held while the viewer's own action runs. */
export const candidateChanged = (review: Review, candidateId: string | null) => review.own !== 'running' && candidateId !== review.reviewedId;
