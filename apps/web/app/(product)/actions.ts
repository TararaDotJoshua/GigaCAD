'use server';

import { formatBytes, HANDLE_PATTERN, isPlanId, type ApprovalRules, type Picks, type ProjectRole } from '@gigacad/core';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiRequest, type Project, type ReleaseRequestDetail } from '../../lib/api';
import { dashboardPath } from '../../lib/hosts';
import { fieldFor, messageFor } from '../../lib/messages';
import { projectPath, releasePath, releaseRequestPath, treePath } from '../../lib/paths';
import { safeReturnPath } from '../../lib/return-path';
import { getAccessToken } from '../../lib/session';

/**
 * Every write in the product goes through here. Actions run on the server with the
 * session's token (the API checks permissions), so the browser never holds an API token.
 */

export interface ActionState {
  readonly error?: string;
  readonly message?: string;
  /** The form field the error is about, which the form focuses. */
  readonly field?: string;
  /** The candidate a release request action left behind (null: none), so the page knows it as the viewer's own. */
  readonly candidateManifestId?: string | null;
  /** Set when an upload was refused because the project owner's storage is full. */
  readonly storageFull?: { readonly usedBytes: number; readonly quotaBytes: number };
  /** The session ended (in another tab, or it expired), so nothing was saved. */
  readonly signedOut?: boolean;
  /** Where to go to fix the error, shown after it. */
  readonly link?: { readonly href: string; readonly label: string };
}

/**
 * What every action returns when the session is gone. Redirecting to log in from an action
 * would throw away what was typed, so the form stays and says what happened.
 */
const SIGNED_OUT = { error: 'You’ve been signed out, so this wasn’t saved. Log in again, then try again.', signedOut: true } as const satisfies ActionState;

/** The storage numbers from a `storage_full` refusal, so the page can offer the right next step. */
function storageFull(error: unknown): ActionState['storageFull'] {
  if (!(error instanceof ApiError) || error.code !== 'storage_full') return undefined;
  const details = (error.details ?? {}) as { usedBytes?: number; quotaBytes?: number };
  return { usedBytes: details.usedBytes ?? 0, quotaBytes: details.quotaBytes ?? 0 };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Action arguments come from the browser, so ids are checked before they go into an
 * API path. Otherwise a crafted `../` id could aim the caller's token at another endpoint.
 */
function id(value: string): string {
  if (!UUID.test(value)) throw new Error('Invalid id');
  return value;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** Errors about what was typed, which send focus back to the field. */
const FIELD_ERRORS = new Set([
  'invalid_request',
  'already_exists',
  'branch_exists',
  'branch_exists_archived',
  'handle_taken',
  'handle_unavailable',
  'name_taken',
  'invalid_name',
  'reserved_name',
  'tag_exists',
  'invalid_tag',
  'not_found',
]);

/** An API error as form state. `field` is the input it's about, if it's about what was typed. */
function failure(error: unknown, field?: string): ActionState {
  const code = error instanceof ApiError ? error.code : '';
  return { error: messageFor(error), storageFull: storageFull(error), ...(field && FIELD_ERRORS.has(code) ? { field: fieldFor(error) ?? field } : {}) };
}

async function mutate(run: (token: string) => Promise<unknown>, message?: string, field?: string): Promise<ActionState> {
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  try {
    await run(token);
  } catch (error) {
    return failure(error, field);
  }
  refresh();
  return message ? { message } : {};
}

/** Creating or forking a project into an address its owner already uses, maybe a deleted project's, which the error links to. */
function projectFailure(error: unknown): ActionState {
  if (error instanceof ApiError && error.code === 'address_deleted') {
    return {
      error: 'You deleted a project at this address. Restore it under Account, or choose another address.',
      field: 'slug',
      link: { href: '/settings#deleted', label: 'Deleted projects' },
    };
  }
  if (error instanceof ApiError && (error.code === 'already_exists' || error.code === 'address_taken')) {
    return { error: 'You already have a project at that address. Choose another.', field: 'slug' };
  }
  return failure(error, 'slug');
}

/** A required field left blank (or only spaces), caught before it reaches the API. */
const blank = (field: string, error: string): ActionState => ({ error, field });

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

// Account

/**
 * Sends someone to Stripe: Checkout for a new plan, or the billing portal if they already
 * pay. `from` is the page they were on, which the billing page links back to on return.
 */
export async function choosePlan(plan: string, interval: string, from?: string): Promise<ActionState> {
  if (!isPlanId(plan) || plan === 'free' || (interval !== 'monthly' && interval !== 'yearly')) return { error: 'Choose a plan.' };
  return goToBilling('/v1/billing/checkout', { plan, interval, ...returnTo(from) });
}

export async function openBillingPortal(from?: string): Promise<ActionState> {
  return goToBilling('/v1/billing/portal', returnTo(from));
}

const returnTo = (from?: string) => (from && safeReturnPath(from, '') ? { from: safeReturnPath(from, '') } : {});

async function goToBilling(path: string, body?: unknown): Promise<ActionState> {
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  let url: string;
  try {
    ({ url } = await apiRequest<{ url: string }>(token, path, json('POST', body)));
  } catch (error) {
    return { error: messageFor(error) };
  }
  redirect(url);
}

export async function saveProfile(_state: ActionState, form: FormData): Promise<ActionState> {
  const optional = (name: string) => (form.has(name) ? { [name]: text(form, name) || null } : {});
  // "example.com" (or "example.com:8080") means the website; the API only takes full http(s)
  // links. Something with its own scheme, like "mailto:", goes as typed for the API to refuse.
  const typed = text(form, 'website');
  const website = typed && !/^[a-z][a-z0-9+.-]*:(?:\/\/|(?!\d))/i.test(typed) ? `https://${typed}` : typed;
  if (website.length > 200) return { error: `Website can be at most 200 characters${website === typed ? '' : ', counting the https:// added to it'}.`, field: 'website' };
  return mutate(
    (token) =>
      apiRequest(
        token,
        '/v1/me',
        json('PATCH', {
          handle: text(form, 'handle'),
          ...optional('displayName'),
          ...optional('bio'),
          ...optional('location'),
          ...(form.has('website') ? { website: website || null } : {}),
        }),
      ),
    'Saved.',
    'handle',
  );
}

const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function uploadAvatar(_state: ActionState, form: FormData): Promise<ActionState> {
  const file = form.get('avatar');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose an image first.' };
  if (!AVATAR_TYPES.has(file.type)) return { error: 'Upload a PNG, JPEG, or WebP image.' };
  if (file.size > 1024 * 1024) return { error: 'Upload an image of 1 MB or less.' };
  const body = new Uint8Array(await file.arrayBuffer());
  return mutate((token) => apiRequest(token, '/v1/me/avatar', { method: 'PUT', body, headers: { 'content-type': file.type } }), 'Avatar updated.');
}

export async function removeAvatar(): Promise<ActionState> {
  return mutate((token) => apiRequest(token, '/v1/me/avatar', json('DELETE')), 'Avatar removed.');
}

export async function signOutDevice(tokenId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/me/tokens/${id(tokenId)}`, json('DELETE')), 'Signed out that device.');
}

// Projects

export async function createProject(_state: ActionState, form: FormData): Promise<ActionState> {
  if (!text(form, 'name')) return blank('name', 'Enter a name.');
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  let project: Project;
  try {
    project = await apiRequest<Project>(
      token,
      '/v1/projects',
      json('POST', {
        name: text(form, 'name'),
        slug: text(form, 'slug'),
        description: text(form, 'description') || undefined,
        visibility: text(form, 'visibility') === 'public' ? 'public' : 'private',
      }),
    );
  } catch (error) {
    return projectFailure(error);
  }
  // The sidebar lists your projects, and the redirect alone wouldn't redraw it.
  refresh();
  redirect(projectPath(project.ownerHandle, project.slug));
}

export async function updateProject(projectId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  if (!text(form, 'name')) return blank('name', 'Enter a name.');
  return mutate(
    (token) =>
      apiRequest(
        token,
        `/v1/projects/${id(projectId)}`,
        json('PATCH', {
          name: text(form, 'name'),
          description: text(form, 'description'),
          // Only the owner gets the field; a disabled select isn't submitted at all.
          ...(form.has('visibility') ? { visibility: text(form, 'visibility') === 'public' ? 'public' : 'private' } : {}),
          license: text(form, 'license') || null,
        }),
      ),
    'Saved.',
    'name',
  );
}

/** Adds someone new. It never changes an existing member's role; the table does that. */
export async function setMember(projectId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const handle = text(form, 'handle').replace(/^@/, '').toLowerCase();
  const role = text(form, 'role') as ProjectRole;
  if (!handle) return blank('handle', 'Enter their handle.');
  if (handle.includes('@')) return { error: 'Add people by their handle, not their email. They need a GigaCAD account with a handle first.', field: 'handle' };
  const nobody = { error: `No one has the handle @${handle}. They need a GigaCAD account with a handle first.`, field: 'handle' };
  if (!HANDLE_PATTERN.test(handle)) return nobody;
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  try {
    await apiRequest(token, `/v1/projects/${id(projectId)}/members`, json('POST', { handle, role }));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'already_member') {
      return { error: `@${handle} is already a ${String((error.details as { role?: string } | undefined)?.role ?? 'member')}. Change their role in the table above.`, field: 'handle' };
    }
    if (error instanceof ApiError && error.code === 'not_found') return nobody;
    return failure(error, 'handle');
  }
  refresh();
  return { message: `Added @${handle} as a ${role}.` };
}

/** Removes the caller from a project shared with them. */
export async function leaveProject(projectId: string, handle: string): Promise<ActionState> {
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  try {
    await apiRequest(token, `/v1/projects/${id(projectId)}/members/${encodeURIComponent(handle)}`, json('DELETE'));
  } catch (error) {
    return { error: messageFor(error) };
  }
  // The sidebar drops the project too, not just the page.
  refresh();
  redirect(dashboardPath());
}

/** Changes a member's role from the members table. */
export async function changeMemberRole(projectId: string, handle: string, role: string): Promise<ActionState> {
  if (!['viewer', 'contributor', 'maintainer'].includes(role)) return { error: 'Choose a role.' };
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/members`, json('PUT', { handle, role })), `@${handle} is now a ${role}.`);
}

/** People to suggest while typing a handle to add. */
export async function findPeople(query: string): Promise<{ handle: string; displayName: string | null }[] | { signedOut: true }> {
  const q = query.trim().replace(/^@/, '');
  if (!q) return [];
  const token = await getAccessToken();
  if (!token) return { signedOut: true };
  try {
    const found = await apiRequest<{ handle: string; displayName: string | null }[]>(token, `/v1/profiles?${new URLSearchParams({ q: q.slice(0, 100) })}`);
    return found.map(({ handle, displayName }) => ({ handle, displayName }));
  } catch {
    return [];
  }
}

export async function removeMember(projectId: string, handle: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/members/${encodeURIComponent(handle)}`, json('DELETE')), `Removed @${handle}.`);
}

export async function setApprovalRules(projectId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  // An emptied field must not quietly become 0, which turns review off.
  if (!/^\d+$/.test(text(form, 'requiredCount'))) return { error: 'Enter how many approvals a release needs.' };
  const rules: ApprovalRules = {
    requiredCount: Number(text(form, 'requiredCount')),
    approverRoles: form.getAll('approverRoles').map(String) as ProjectRole[],
    approverUserIds: form.getAll('approverUserIds').map(String),
    allowSelfApproval: form.get('allowSelfApproval') === 'on',
    requireCleanRebuild: form.get('requireCleanRebuild') === 'on',
  };
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/approval-rules`, json('PUT', rules)), 'Saved the approval rules.');
}

export async function deleteProject(projectId: string, slug: string, _state: ActionState, form: FormData): Promise<ActionState> {
  if (text(form, 'confirm') !== slug) return { error: `Type ${slug} to confirm.`, field: 'confirm' };
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  try {
    await apiRequest(token, `/v1/projects/${id(projectId)}`, json('DELETE'));
  } catch (error) {
    return { error: messageFor(error) };
  }
  // Drops it from the sidebar, and from the page Back would return to.
  refresh();
  redirect(`${dashboardPath()}?deleted=${encodeURIComponent(slug)}`);
}

export async function restoreProject(projectId: string): Promise<ActionState> {
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  let project: Project;
  try {
    project = await apiRequest<Project>(token, `/v1/projects/${id(projectId)}/restore`, json('POST'));
  } catch (error) {
    const full = storageFull(error);
    if (full && error instanceof ApiError) {
      const needed = (error.details as { neededBytes?: number } | undefined)?.neededBytes ?? 0;
      return {
        error: `Restoring it needs ${formatBytes(needed)}, but only ${formatBytes(Math.max(0, full.quotaBytes - full.usedBytes))} of your ${formatBytes(full.quotaBytes)} is free.`,
        storageFull: full,
      };
    }
    return { error: messageFor(error) };
  }
  refresh();
  redirect(`${projectPath(project.ownerHandle, project.slug)}?restored=1`);
}

/**
 * A short-lived download link with the file's real name. It is never rendered into a page.
 * No session is fine: anyone can download from a public project, and the API decides.
 */
export async function downloadLink(projectId: string, sha256: string, filename: string): Promise<{ url?: string; error?: string }> {
  const token = await getAccessToken();
  try {
    const plan = await apiRequest<{ downloads: { sha256: string; url: string }[] }>(
      token,
      `/v1/projects/${id(projectId)}/blobs/downloads`,
      json('POST', { sha256s: [sha256], filenames: { [sha256]: filename } }),
    );
    const url = plan.downloads[0]?.url;
    return url ? { url } : { error: 'This file is not available.' };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

// Branches

// Sharing

export async function setStar(projectId: string, starred: boolean): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/star`, json(starred ? 'PUT' : 'DELETE')));
}

export async function forkProject(sourceId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  if (!text(form, 'name')) return blank('name', 'Enter a name.');
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  const release = Number(text(form, 'releaseNumber'));
  let project: Project;
  try {
    project = await apiRequest<Project>(
      token,
      `/v1/projects/${id(sourceId)}/forks`,
      json('POST', {
        name: text(form, 'name'),
        slug: text(form, 'slug'),
        visibility: text(form, 'visibility') === 'public' ? 'public' : 'private',
        ...(release > 0 ? { releaseNumber: release } : {}),
      }),
    );
  } catch (error) {
    return projectFailure(error);
  }
  refresh();
  redirect(`${projectPath(project.ownerHandle, project.slug)}?forked=1`);
}

export async function createBranch(projectId: string, owner: string, slug: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const name = text(form, 'name');
  if (!name) return blank('name', 'Enter a name.');
  const from = Number(text(form, 'fromRelease'));
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  try {
    await apiRequest(token, `/v1/projects/${id(projectId)}/branches`, json('POST', { name, ...(from > 0 ? { fromRelease: from } : {}) }));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'branch_exists_archived') {
      const existing = (error.details as { name?: string } | undefined)?.name ?? name;
      return { error: `An archived branch is already called ${existing}. Restore it or pick another name.`, field: 'name' };
    }
    return failure(error, 'name');
  }
  // The sidebar lists open branches; redirecting alone leaves it without the new one.
  refresh();
  redirect(projectPath(owner, slug, 'branches', name));
}

/** The holder giving back their own lock, from the browser instead of the drive or CLI. */
export async function checkInBranch(branchId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/branches/${id(branchId)}/checkin`, json('POST', {})), 'Checked in.');
}

export async function forceReleaseLock(branchId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/branches/${id(branchId)}/force-release`, json('POST', {})), 'The lock was released.');
}

export async function archiveBranch(branchId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/branches/${id(branchId)}/archive`, json('POST', {})), 'Archived.');
}

export async function unarchiveBranch(branchId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/branches/${id(branchId)}/unarchive`, json('POST', {})), 'Restored. The branch is open again.');
}

export async function openReleaseRequest(branchId: string, owner: string, slug: string, _state: ActionState, form: FormData): Promise<ActionState> {
  if (!text(form, 'title')) return blank('title', 'Give the request a title.');
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  let detail: ReleaseRequestDetail;
  try {
    detail = await apiRequest<ReleaseRequestDetail>(
      token,
      `/v1/branches/${id(branchId)}/release-requests`,
      json('POST', { title: text(form, 'title'), body: text(form, 'body') || undefined }),
    );
  } catch (error) {
    return failure(error, 'title');
  }
  // The API builds the first candidate from the default picks as it opens the request.
  refresh();
  redirect(releaseRequestPath(owner, slug, detail.releaseRequest.number));
}

// Release requests

/** Saves the picks and regenerates the candidate from them, so saving is the only step. */
export async function savePicks(requestId: string, picks: Picks): Promise<ActionState> {
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  let detail: ReleaseRequestDetail;
  try {
    detail = await apiRequest<ReleaseRequestDetail>(token, `/v1/release-requests/${id(requestId)}/picks`, json('PUT', picks));
  } catch (error) {
    return { error: messageFor(error) };
  }
  // Saving picks clears the candidate; whatever is built next (or nothing) is this viewer's own doing.
  if (!detail.preview.ok || !detail.changesMain) {
    refresh();
    return { message: detail.preview.ok ? 'Saved. These picks leave main as it is, so there’s nothing to release.' : 'Saved. Fix the pick errors to build the candidate.', candidateManifestId: null };
  }
  let built: ReleaseRequestDetail;
  try {
    built = await apiRequest<ReleaseRequestDetail>(token, `/v1/release-requests/${id(requestId)}/candidate`, json('POST', {}));
  } catch (error) {
    refresh();
    return { error: `Saved, but the candidate didn’t build: ${messageFor(error)}`, candidateManifestId: null };
  }
  refresh();
  return { message: 'Saved and regenerated the candidate.', candidateManifestId: built.candidate?.manifestId ?? null };
}

export async function generateCandidate(requestId: string): Promise<ActionState> {
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  let built: ReleaseRequestDetail;
  try {
    built = await apiRequest<ReleaseRequestDetail>(token, `/v1/release-requests/${id(requestId)}/candidate`, json('POST', {}));
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { message: 'Built the candidate.', candidateManifestId: built.candidate?.manifestId ?? null };
}

/** A refusal because the candidate changed under the page: show the new one so it can be reviewed. */
function refreshIfStale(error: unknown): void {
  if (error instanceof ApiError && (error.code === 'stale_candidate' || error.code === 'main_moved' || error.code === 'release_request_finished')) refresh();
}

/**
 * Approves the candidate the viewer reviewed (`candidateManifestId`, sent by the page).
 * `releaser` names who can release it when the approver can't, so they know what happens next.
 */
/** What the viewer reviewed: the candidate, and when its exports last changed, so a swapped export is refused as stale. */
const reviewedBody = (candidateManifestId: string, exportsChangedAt: string | null) => ({
  candidateManifestId: id(candidateManifestId),
  exportsChangedAt: exportsChangedAt && !Number.isNaN(Date.parse(exportsChangedAt)) ? exportsChangedAt : null,
});

export async function approveCandidate(requestId: string, releaser: string | null, candidateManifestId: string, exportsChangedAt: string | null): Promise<ActionState> {
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  try {
    await apiRequest(token, `/v1/release-requests/${id(requestId)}/approvals`, json('POST', reviewedBody(candidateManifestId, exportsChangedAt)));
  } catch (error) {
    refreshIfStale(error);
    return { error: messageFor(error) };
  }
  refresh();
  return { message: releaser ? `Approved. ${releaser} can release it.` : 'Approved.' };
}

export async function withdrawApproval(requestId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/release-requests/${id(requestId)}/approvals`, json('DELETE')), 'Withdrew your approval.');
}

export async function closeReleaseRequest(requestId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/release-requests/${id(requestId)}/close`, json('POST', {})), 'Closed. The branch is open again.');
}

/**
 * Releases the candidate the viewer reviewed (sent by the page). With `approve`, approves it
 * first: for someone whose own approval is the last one needed and who chose to do both. If
 * the approval lands but the release doesn't, the page says so and shows the approval.
 */
export async function releaseCandidate(
  requestId: string,
  owner: string,
  slug: string,
  input: { candidateManifestId: string; exportsChangedAt: string | null; approve: boolean; notes: string },
): Promise<ActionState> {
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  const reviewed = reviewedBody(input.candidateManifestId, input.exportsChangedAt);
  let approved = false;
  let number: number;
  try {
    if (input.approve) {
      await apiRequest(token, `/v1/release-requests/${id(requestId)}/approvals`, json('POST', reviewed));
      approved = true;
    }
    const notes = input.notes.trim();
    const result = await apiRequest<{ release: { number: number } }>(token, `/v1/release-requests/${id(requestId)}/release`, json('POST', notes ? { ...reviewed, notes } : reviewed));
    number = result.release.number;
  } catch (error) {
    if (approved) {
      refresh();
      return { error: `Approved, but not released. ${messageFor(error)}` };
    }
    refreshIfStale(error);
    return { error: messageFor(error) };
  }
  refresh();
  redirect(releasePath(owner, slug, number));
}

// Project files

const SHA256 = /^[0-9a-f]{64}$/;

function sha(value: string): string {
  if (!SHA256.test(value)) throw new Error('Invalid file hash');
  return value;
}

const parent = (value: string | null) => (value === null || value === '' ? null : id(value));

export interface UploadStart {
  readonly error?: string;
  readonly storageFull?: ActionState['storageFull'];
  readonly signedOut?: boolean;
  /** Null when the project already has these contents, so nothing needs uploading. */
  readonly upload?: { readonly uploadId: string; readonly url: string; readonly headers: Record<string, string> } | null;
}

/**
 * The first step of adding a file from the browser: a short-lived link to upload its
 * contents straight to storage. The browser sends the bytes; the API checks their hash.
 */
export async function startUpload(projectId: string, sha256: string, size: number): Promise<UploadStart> {
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  try {
    const plan = await apiRequest<{ uploads: { uploadId: string; sha256: string; url: string; headers: Record<string, string> }[] }>(
      token,
      `/v1/projects/${id(projectId)}/blobs/uploads`,
      json('POST', { blobs: [{ sha256: sha(sha256), size }] }),
    );
    const upload = plan.uploads[0];
    return { upload: upload ? { uploadId: upload.uploadId, url: upload.url, headers: upload.headers } : null };
  } catch (error) {
    return { error: messageFor(error), storageFull: storageFull(error) };
  }
}

export async function finishUpload(projectId: string, uploadId: string): Promise<ActionState> {
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  try {
    const result = await apiRequest<{ failed: { reason: string }[] }>(
      token,
      `/v1/projects/${id(projectId)}/blobs/complete`,
      json('POST', { uploadIds: [id(uploadId)] }),
    );
    const failed = result.failed[0]?.reason;
    if (failed === 'storage_full') return { error: 'The project owner is out of storage.', storageFull: { usedBytes: 0, quotaBytes: 0 } };
    if (failed) return { error: 'The upload didn’t arrive intact. Try again.' };
    return {};
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/** Adds an uploaded file to a root folder. */
export async function addRootFile(projectId: string, parentId: string | null, name: string, sha256: string): Promise<ActionState & { readonly taken?: boolean }> {
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  try {
    await apiRequest(token, `/v1/projects/${id(projectId)}/directory/files`, json('POST', { parentId: parent(parentId), name, blob: sha(sha256) }));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'name_taken') return { error: messageFor(error), taken: true };
    return { error: messageFor(error), storageFull: storageFull(error) };
  }
  refresh();
  return {};
}

/** Records uploaded contents as a root file's next revision. */
export async function replaceRootFile(projectId: string, entryId: string, sha256: string): Promise<ActionState> {
  return mutate(
    (token) => apiRequest(token, `/v1/projects/${id(projectId)}/directory/entries/${id(entryId)}/revisions`, json('POST', { blob: sha(sha256) })),
    'Saved a new revision.',
  );
}

export async function createFolder(projectId: string, parentId: string | null, _state: ActionState, form: FormData): Promise<ActionState> {
  const name = text(form, 'name');
  if (!name) return blank('name', 'Enter a name.');
  return mutate(
    (token) => apiRequest(token, `/v1/projects/${id(projectId)}/directory/folders`, json('POST', { parentId: parent(parentId), name })),
    `Created ${name}.`,
    'name',
  );
}

/**
 * Renames and moves a root entry in one step. An empty destination is the project root.
 * Only fields that differ from the page's `was*` values are sent, so a rename never moves
 * the entry back to a folder the form showed before someone else moved it.
 */
export async function moveEntry(projectId: string, entryId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const name = text(form, 'name');
  if (!name) return blank('name', 'Enter a name.');
  const change = {
    ...(form.has('wasName') && name === text(form, 'wasName') ? {} : { name }),
    ...(form.has('wasParentId') && text(form, 'parentId') === text(form, 'wasParentId') ? {} : { parentId: parent(text(form, 'parentId')) }),
  };
  if (Object.keys(change).length === 0) return { message: 'Nothing to change.' };
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/directory/entries/${id(entryId)}`, json('PATCH', change)), 'Saved.', 'name');
}

/** From the directory's right-click menu: one change at a time, staying in the folder. */
export async function renameEntry(projectId: string, entryId: string, name: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/directory/entries/${id(entryId)}`, json('PATCH', { name: name.trim() })));
}

export async function moveEntryTo(projectId: string, entryId: string, parentId: string | null): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/directory/entries/${id(entryId)}`, json('PATCH', { parentId: parent(parentId) })));
}

export async function removeEntry(projectId: string, entryId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/directory/entries/${id(entryId)}`, json('DELETE')));
}

export async function deleteEntry(projectId: string, entryId: string, owner: string, slug: string, parentPath: string): Promise<ActionState> {
  const token = await getAccessToken();
  if (!token) return SIGNED_OUT;
  try {
    await apiRequest(token, `/v1/projects/${id(projectId)}/directory/entries/${id(entryId)}`, json('DELETE'));
  } catch (error) {
    return { error: messageFor(error) };
  }
  redirect(treePath(owner, slug, parentPath));
}

export async function createTag(projectId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const name = text(form, 'name');
  if (!name) return blank('name', 'Enter a tag name.');
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/tags`, json('POST', { name })), `Added ${name}.`, 'name');
}

export async function renameTag(projectId: string, tagId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const name = text(form, 'name');
  if (!name) return blank('name', 'Enter a tag name.');
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/tags/${id(tagId)}`, json('PATCH', { name })), 'Renamed.', 'name');
}

export async function deleteTag(projectId: string, tagId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/tags/${id(tagId)}`, json('DELETE')));
}

export async function setFileTags(projectId: string, itemId: string, tagIds: string[]): Promise<ActionState> {
  return mutate((token) =>
    apiRequest(token, `/v1/projects/${id(projectId)}/items/${id(itemId)}/tags`, json('PUT', { tagIds: tagIds.map(id) })),
  );
}

export async function setFavorite(projectId: string, itemId: string, favorite: boolean): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/items/${id(itemId)}/favorite`, json(favorite ? 'PUT' : 'DELETE')));
}
