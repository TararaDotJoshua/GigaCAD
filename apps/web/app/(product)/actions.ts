'use server';

import { isPlanId, type ApprovalRules, type Picks, type ProjectRole } from '@gigacad/core';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiRequest, type Project, type ReleaseRequestDetail } from '../../lib/api';
import { messageFor } from '../../lib/messages';
import { projectPath, releasePath, releaseRequestPath, treePath } from '../../lib/paths';
import { requireAccessToken } from '../../lib/session';

/**
 * Every write in the product goes through here. Actions run on the server with the
 * session's token (the API checks permissions), so the browser never holds an API token.
 */

export interface ActionState {
  readonly error?: string;
  readonly message?: string;
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

async function mutate(run: (token: string) => Promise<unknown>, message?: string): Promise<ActionState> {
  const token = await requireAccessToken();
  try {
    await run(token);
  } catch (error) {
    return { error: messageFor(error) };
  }
  refresh();
  return message ? { message } : {};
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

// Account

/** Sends someone to Stripe: Checkout for a new plan, or the billing portal if they already pay. */
export async function choosePlan(plan: string, interval: string): Promise<ActionState> {
  if (!isPlanId(plan) || plan === 'free' || (interval !== 'monthly' && interval !== 'yearly')) return { error: 'Choose a plan.' };
  return goToBilling('/v1/billing/checkout', { plan, interval });
}

export async function openBillingPortal(): Promise<ActionState> {
  return goToBilling('/v1/billing/portal');
}

async function goToBilling(path: string, body?: unknown): Promise<ActionState> {
  const token = await requireAccessToken();
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
  // "example.com" means the website; the API only takes full http(s) links.
  const website = text(form, 'website');
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
          ...(form.has('website') ? { website: website && !/^[a-z][a-z0-9+.-]*:/i.test(website) ? `https://${website}` : website || null } : {}),
        }),
      ),
    'Saved.',
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
  const token = await requireAccessToken();
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
    return { error: messageFor(error) };
  }
  redirect(projectPath(project.ownerHandle, project.slug));
}

export async function updateProject(projectId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  return mutate(
    (token) =>
      apiRequest(
        token,
        `/v1/projects/${id(projectId)}`,
        json('PATCH', {
          name: text(form, 'name'),
          description: text(form, 'description'),
          visibility: text(form, 'visibility') === 'public' ? 'public' : 'private',
          license: text(form, 'license') || null,
        }),
      ),
    'Saved.',
  );
}

export async function setMember(projectId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const handle = text(form, 'handle').replace(/^@/, '').toLowerCase();
  const role = text(form, 'role') as ProjectRole;
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/members`, json('PUT', { handle, role })), `Saved @${handle}.`);
}

export async function removeMember(projectId: string, handle: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/members/${encodeURIComponent(handle)}`, json('DELETE')), `Removed @${handle}.`);
}

export async function setApprovalRules(projectId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const rules: ApprovalRules = {
    requiredCount: Number(text(form, 'requiredCount')) || 0,
    approverRoles: form.getAll('approverRoles').map(String) as ProjectRole[],
    approverUserIds: form.getAll('approverUserIds').map(String),
    allowSelfApproval: form.get('allowSelfApproval') === 'on',
    requireCleanRebuild: form.get('requireCleanRebuild') === 'on',
  };
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/approval-rules`, json('PUT', rules)), 'Saved the approval rules.');
}

export async function deleteProject(projectId: string, slug: string, _state: ActionState, form: FormData): Promise<ActionState> {
  if (text(form, 'confirm') !== slug) return { error: `Type ${slug} to confirm.` };
  const token = await requireAccessToken();
  try {
    await apiRequest(token, `/v1/projects/${id(projectId)}`, json('DELETE'));
  } catch (error) {
    return { error: messageFor(error) };
  }
  redirect('/app');
}

export async function restoreProject(projectId: string): Promise<ActionState> {
  const token = await requireAccessToken();
  let project: Project;
  try {
    project = await apiRequest<Project>(token, `/v1/projects/${id(projectId)}/restore`, json('POST'));
  } catch (error) {
    return { error: messageFor(error) };
  }
  redirect(projectPath(project.ownerHandle, project.slug));
}

/** A short-lived download link with the file's real name. It is never rendered into a page. */
export async function downloadLink(projectId: string, sha256: string, filename: string): Promise<{ url?: string; error?: string }> {
  const token = await requireAccessToken();
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
  const token = await requireAccessToken();
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
    return { error: messageFor(error) };
  }
  redirect(projectPath(project.ownerHandle, project.slug));
}

export async function createBranch(projectId: string, owner: string, slug: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const name = text(form, 'name');
  const from = Number(text(form, 'fromRelease'));
  const token = await requireAccessToken();
  try {
    await apiRequest(token, `/v1/projects/${id(projectId)}/branches`, json('POST', { name, ...(from > 0 ? { fromRelease: from } : {}) }));
  } catch (error) {
    return { error: messageFor(error) };
  }
  redirect(projectPath(owner, slug, 'branches', name));
}

export async function forceReleaseLock(branchId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/branches/${id(branchId)}/force-release`, json('POST', {})), 'The lock was released.');
}

export async function archiveBranch(branchId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/branches/${id(branchId)}/archive`, json('POST', {})), 'Archived.');
}

export async function openReleaseRequest(branchId: string, owner: string, slug: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const token = await requireAccessToken();
  let detail: ReleaseRequestDetail;
  try {
    detail = await apiRequest<ReleaseRequestDetail>(
      token,
      `/v1/branches/${id(branchId)}/release-requests`,
      json('POST', { title: text(form, 'title'), body: text(form, 'body') || undefined }),
    );
  } catch (error) {
    return { error: messageFor(error) };
  }
  redirect(releaseRequestPath(owner, slug, detail.releaseRequest.number));
}

// Release requests

export async function savePicks(requestId: string, picks: Picks): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/release-requests/${id(requestId)}/picks`, json('PUT', picks)), 'Saved picks.');
}

export async function generateCandidate(requestId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/release-requests/${id(requestId)}/candidate`, json('POST', {})), 'Generated the candidate.');
}

export async function approveCandidate(requestId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/release-requests/${id(requestId)}/approvals`, json('POST', {})), 'Approved.');
}

export async function withdrawApproval(requestId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/release-requests/${id(requestId)}/approvals`, json('DELETE')), 'Withdrew your approval.');
}

export async function closeReleaseRequest(requestId: string): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/release-requests/${id(requestId)}/close`, json('POST', {})), 'Closed. The branch is open again.');
}

export async function releaseCandidate(requestId: string, owner: string, slug: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const token = await requireAccessToken();
  let number: number;
  try {
    const result = await apiRequest<{ release: { number: number } }>(
      token,
      `/v1/release-requests/${id(requestId)}/release`,
      json('POST', text(form, 'notes') ? { notes: text(form, 'notes') } : {}),
    );
    number = result.release.number;
  } catch (error) {
    return { error: messageFor(error) };
  }
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
  /** Null when the project already has these contents, so nothing needs uploading. */
  readonly upload?: { readonly uploadId: string; readonly url: string; readonly headers: Record<string, string> } | null;
}

/**
 * The first step of adding a file from the browser: a short-lived link to upload its
 * contents straight to storage. The browser sends the bytes; the API checks their hash.
 */
export async function startUpload(projectId: string, sha256: string, size: number): Promise<UploadStart> {
  const token = await requireAccessToken();
  try {
    const plan = await apiRequest<{ uploads: { uploadId: string; sha256: string; url: string; headers: Record<string, string> }[] }>(
      token,
      `/v1/projects/${id(projectId)}/blobs/uploads`,
      json('POST', { blobs: [{ sha256: sha(sha256), size }] }),
    );
    const upload = plan.uploads[0];
    return { upload: upload ? { uploadId: upload.uploadId, url: upload.url, headers: upload.headers } : null };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function finishUpload(projectId: string, uploadId: string): Promise<ActionState> {
  const token = await requireAccessToken();
  try {
    const result = await apiRequest<{ failed: { reason: string }[] }>(
      token,
      `/v1/projects/${id(projectId)}/blobs/complete`,
      json('POST', { uploadIds: [id(uploadId)] }),
    );
    const failed = result.failed[0]?.reason;
    if (failed === 'storage_full') return { error: 'The project owner is out of storage.' };
    if (failed) return { error: 'The upload didn’t arrive intact. Try again.' };
    return {};
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/** Adds an uploaded file to a root folder. */
export async function addRootFile(projectId: string, parentId: string | null, name: string, sha256: string): Promise<ActionState & { readonly taken?: boolean }> {
  const token = await requireAccessToken();
  try {
    await apiRequest(token, `/v1/projects/${id(projectId)}/directory/files`, json('POST', { parentId: parent(parentId), name, blob: sha(sha256) }));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'name_taken') return { error: messageFor(error), taken: true };
    return { error: messageFor(error) };
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
  return mutate(
    (token) => apiRequest(token, `/v1/projects/${id(projectId)}/directory/folders`, json('POST', { parentId: parent(parentId), name })),
    `Created ${name}.`,
  );
}

/** Renames and moves a root entry in one step. An empty destination is the project root. */
export async function moveEntry(projectId: string, entryId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  return mutate(
    (token) =>
      apiRequest(
        token,
        `/v1/projects/${id(projectId)}/directory/entries/${id(entryId)}`,
        json('PATCH', { name: text(form, 'name'), parentId: parent(text(form, 'parentId')) }),
      ),
    'Saved.',
  );
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
  const token = await requireAccessToken();
  try {
    await apiRequest(token, `/v1/projects/${id(projectId)}/directory/entries/${id(entryId)}`, json('DELETE'));
  } catch (error) {
    return { error: messageFor(error) };
  }
  redirect(treePath(owner, slug, parentPath));
}

export async function createTag(projectId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const name = text(form, 'name');
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/tags`, json('POST', { name })), `Added ${name}.`);
}

export async function renameTag(projectId: string, tagId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  return mutate((token) => apiRequest(token, `/v1/projects/${id(projectId)}/tags/${id(tagId)}`, json('PATCH', { name: text(form, 'name') })), 'Renamed.');
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
