/** A release request as the project's list shows it, as far as approving goes. */
export interface ReviewableRequest {
  readonly number: number;
  readonly status: string;
  readonly candidateManifestId?: string | null;
}

/** A candidate's id, short enough to compare at a glance with the web page's. */
export const shortCandidate = (id: string) => id.slice(0, 7);

/**
 * The candidate Approve would approve: the one this view opened for review (`reviewed`, by
 * request number), and only while the list still shows it. A candidate rebuilt since, or one
 * never opened from here, needs a review first, so the app never approves something unseen.
 */
export function approvableCandidate(request: ReviewableRequest, reviewed: ReadonlyMap<number, string>): string | null {
  if (request.status !== 'candidate' || !request.candidateManifestId) return null;
  return reviewed.get(request.number) === request.candidateManifestId ? request.candidateManifestId : null;
}

/** Whether the request's candidate changed after this view opened it for review. A finished request has nothing left to review. */
export function candidateChangedSinceReview(request: ReviewableRequest, reviewed: ReadonlyMap<number, string>): boolean {
  if (request.status !== 'candidate') return false;
  const seen = reviewed.get(request.number);
  return Boolean(seen && request.candidateManifestId && seen !== request.candidateManifestId);
}
