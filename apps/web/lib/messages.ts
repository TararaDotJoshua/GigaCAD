import { ApiError } from './api';

/** What to tell people for API errors they can act on. Mirrors the CLI's hints, worded for the web. */
const MESSAGES: Readonly<Record<string, string>> = {
  unauthorized: 'Your session expired. Log in again.',
  network: 'The GigaCAD API is unreachable. Try again in a moment.',
  checked_out: 'Someone else has this branch checked out. Ask them to check it in first.',
  branch_not_open: 'This branch can’t be changed right now.',
  branch_exists: 'A branch with that name already exists.',
  already_exists: 'That name is already taken.',
  main_moved: 'Main has a newer release. Regenerate the candidate to include it.',
  approval_required: 'This release request still needs approvals or a rebuild report.',
  candidate_invalid: 'Fix the pick errors before generating a candidate.',
  no_candidate: 'Generate a candidate first.',
  stale_candidate: 'The candidate changed. Refresh the page and try again.',
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
    return MESSAGES[error.code] ?? error.message;
  }
  return 'Something went wrong. Try again.';
}

/** The API's field-level validation messages, joined into one sentence. */
function detailMessage(error: ApiError): string | undefined {
  if (!Array.isArray(error.details)) return undefined;
  const messages = (error.details as { message?: string }[]).map((item) => item.message).filter(Boolean);
  return messages.length > 0 ? `${messages.join('. ')}.` : undefined;
}
