'use server';

import { isPlanId, type ApprovalRules, type Picks, type ProjectRole } from '@gigacad/core';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiRequest, type Project, type ReleaseRequestDetail } from '../../lib/api';
import { messageFor } from '../../lib/messages';
import { projectPath, releasePath, releaseRequestPath } from '../../lib/paths';
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
  const displayName = text(form, 'displayName');
  return mutate(
    (token) =>
      apiRequest(token, '/v1/me', json('PATCH', { handle: text(form, 'handle'), ...(form.has('displayName') ? { displayName: displayName || null } : {}) })),
    'Saved.',
  );
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
