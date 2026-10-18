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
  handle_taken: 'That handle is taken. Pick another.',
  branch_not_archived: 'Only archived branches can be restored.',
  branch_frozen: 'Close its release request before archiving this branch.',
  not_found: 'That no longer exists. Refresh the page to see where things are now.',
  owner_role_fixed: 'The project owner’s role can’t be changed.',
  single_owner: 'A project has exactly one owner.',
  tag_exists: 'A tag with that name already exists.',
  invalid_tag: 'Tag names are 1 to 50 characters.',
  invalid_image: 'Upload a PNG, JPEG, or WebP image.',
  image_too_large: 'Upload an image of 1 MB or less.',
};

/** The API's field names as the page calls them, for "Enter a name." and "Shorten the title." */
const FIELDS: Readonly<Record<string, readonly [article: string, label: string]>> = {
  name: ['a', 'name'],
  slug: ['an', 'address'],
  title: ['a', 'title'],
  handle: ['a', 'handle'],
  body: ['a', 'description'],
  description: ['a', 'description'],
  displayName: ['a', 'display name'],
  location: ['a', 'location'],
  website: ['a', 'website'],
  license: ['a', 'license'],
};

export function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'invalid_request') return detailMessage(error) ?? sentence(error.message);
    if (error.code === 'forbidden') return detailMessage(error) ?? sentence(error.message);
    if (error.code === 'name_taken') {
      const name = (error.details as { name?: string } | undefined)?.name;
      return name ? `There’s already something named ${name} in this folder.` : 'There’s already something with that name in this folder.';
    }
    // A project that's gone missing mid-visit: removed from it, or it was deleted or made private.
    if (error.code === 'not_found' && error.message === 'Project not found') return 'You no longer have access to this project. Refresh the page.';
    return releaseMessage(error) ?? MESSAGES[error.code] ?? sentence(error.message);
  }
  return 'Something went wrong. Try again.';
}

/** The form field an API validation error is about, when it names one. */
export function fieldFor(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return undefined;
  const path = (error.details as { path?: unknown }[])[0]?.path;
  return typeof path === 'string' && /^[A-Za-z]+$/.test(path) ? path : undefined;
}

/** The API's field-level validation messages, as product sentences. */
function detailMessage(error: ApiError): string | undefined {
  if (!Array.isArray(error.details)) return undefined;
  const messages = (error.details as { path?: string; message?: string }[]).map(issueMessage).filter((message): message is string => Boolean(message));
  return messages.length > 0 ? [...new Set(messages)].join(' ') : undefined;
}

/** Zod's "Too small: expected string to have >=1 characters" for `name` becomes "Enter a name." */
function issueMessage(issue: { path?: string; message?: string }): string | undefined {
  if (!issue.message) return undefined;
  const field = issue.path ? FIELDS[issue.path] : undefined;
  if (field && /^Too small: expected string/.test(issue.message)) return `Enter ${field[0]} ${field[1]}.`;
  if (field && /^Too big: expected string/.test(issue.message)) return `Shorten the ${field[1]}.`;
  return sentence(issue.message);
}

/** API messages are terse ("Tag not found"); the web always shows full sentences. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
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
