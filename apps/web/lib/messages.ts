import type { ReleaseBlocker } from '@gigacad/core';
import { ApiError } from './api';
import { blockerText } from './describe';

/** What to tell people for API errors they can act on. Mirrors the CLI's hints, worded for the web. */
const MESSAGES: Readonly<Record<string, string>> = {
  unauthorized: 'Your session expired. Log in again.',
  network: 'The GigaCAD API is unreachable. Try again in a moment.',
  checked_out: 'Someone else has this branch checked out. Ask them to check it in first.',
  branch_not_open: 'This branch can’t be changed right now.',
  branch_exists: 'A branch with that name already exists.',
  already_exists: 'That name is already taken.',
  main_moved: 'Main has a newer release. Regenerate the candidate to include it.',
  approval_required: 'This release request isn’t ready to release yet.',
  candidate_invalid: 'Fix the pick errors before building a candidate.',
  no_candidate: 'There’s no candidate yet. Build one from the picks first.',
  no_changes: 'These picks leave main as it is, so there’s nothing to release.',
  stale_candidate: 'The candidate changed since this page loaded. Look it over again, then try again.',
  release_request_finished: 'This release request is already finished.',
  forbidden: 'You don’t have permission to do that in this project.',
  nothing_to_fork: 'This project has no releases to fork yet.',
  billing_unavailable: 'Paid plans aren’t available yet.',
  no_billing_account: 'Choose a paid plan first.',
};

export function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'forbidden' || error.code === 'invalid_request' || error.code === 'owner_role_fixed' || error.code === 'single_owner') {
      return detailMessage(error) ?? error.message;
    }
    return releaseMessage(error) ?? MESSAGES[error.code] ?? error.message;
  }
  return 'Something went wrong. Try again.';
}

/** The API's field-level validation messages, joined into one sentence. */
function detailMessage(error: ApiError): string | undefined {
  if (!Array.isArray(error.details)) return undefined;
  const messages = (error.details as { message?: string }[]).map((item) => item.message).filter(Boolean);
  return messages.length > 0 ? `${messages.join('. ')}.` : undefined;
}

/** Release refusals that say what's missing, or which release already happened. */
function releaseMessage(error: ApiError): string | undefined {
  const details = (error.details ?? {}) as { blockers?: ReleaseBlocker[]; releaseNumber?: number | null; status?: string };
  if (error.code === 'approval_required' && details.blockers?.length) return `Not ready to release. ${details.blockers.map(blockerText).join(' ')}`;
  if (error.code === 'release_request_finished') {
    return details.releaseNumber ? `This release request was already released as v${details.releaseNumber}.` : 'This release request is closed.';
  }
  return undefined;
}
