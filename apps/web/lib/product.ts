import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import {
  ApiError,
  apiRequest,
  type ApprovalRules,
  type Billing,
  type Branch,
  type BranchDetail,
  type CommitDetail,
  type Commit,
  type Member,
  type Profile,
  type Project,
  type ProjectCard,
  type ProjectEvent,
  type Release,
  type ReleaseDetail,
  type ReleaseRequestDetail,
  type ReleaseRequestSummary,
  type ThumbnailLinks,
  type FileExport,
  type UserPage,
} from './api';
import { getAccessToken } from './session';

/**
 * Server-side API reads for product pages, cached for the length of one request. They
 * send the session when there is one; public projects can be read signed out.
 */
async function get<T>(path: string): Promise<T> {
  return apiRequest<T>(await getAccessToken(), path);
}

/** Turns the API's 404 (also used for private projects you can't see) into the not-found page. */
async function orNotFound<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

export const getMe = cache(() => get<Profile>('/v1/me'));
/** The signed-in user, or null for a signed-out visitor to a public page. */
export const getViewer = cache(async () => ((await getAccessToken()) ? getMe() : null));
export const getMyProjectsIfSignedIn = cache(async () => ((await getAccessToken()) ? getMyProjects() : []));
export const getExplore = cache((q: string, sort: 'stars' | 'recent') =>
  get<ProjectCard[]>(`/v1/explore?${new URLSearchParams({ sort, ...(q ? { q } : {}) })}`),
);
export const getUserPage = cache((handle: string) => orNotFound(get<UserPage>(`/v1/users/${encodeURIComponent(handle)}`)));
export const getUserStars = cache((handle: string) => orNotFound(get<ProjectCard[]>(`/v1/users/${encodeURIComponent(handle)}/stars`)));
/** Thumbnail links for a project's files. They're a nicety, so a failure shows file glyphs instead of an error. */
export async function getThumbnails(projectId: string, sha256s: readonly string[]): Promise<Record<string, string>> {
  if (sha256s.length === 0) return {};
  try {
    const links = await apiRequest<ThumbnailLinks>(await getAccessToken(), `/v1/projects/${projectId}/thumbnails`, {
      method: 'POST',
      body: JSON.stringify({ sha256s: [...new Set(sha256s)].slice(0, 1000) }),
    });
    return links.thumbnails;
  } catch {
    return {};
  }
}
/** STEP and STL exports of a project's SolidWorks files, by file hash. Like thumbnails, a failure just leaves them out. */
export async function getFileExports(projectId: string, sha256s: readonly string[]): Promise<Record<string, FileExport[]>> {
  if (sha256s.length === 0) return {};
  try {
    const result = await apiRequest<{ exports: Record<string, FileExport[]> }>(await getAccessToken(), `/v1/projects/${projectId}/exports/lookup`, {
      method: 'POST',
      body: JSON.stringify({ sha256s: [...new Set(sha256s)].slice(0, 1000) }),
    });
    return result.exports;
  } catch {
    return {};
  }
}
export const getBilling = cache(() => get<Billing>('/v1/me/billing'));
export const getMyProjects = cache(() => get<Project[]>('/v1/projects'));

export const getProject = cache(async (owner: string, slug: string) => {
  try {
    return await get<Project>(`/v1/users/${encodeURIComponent(owner)}/projects/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // Private projects look missing to outsiders. A signed-out visitor may just need to log in.
      if (!(await getAccessToken())) redirect(`/login?next=${encodeURIComponent(`/${owner}/${slug}`)}`);
      notFound();
    }
    throw error;
  }
});

export const getBranches = cache((projectId: string) => get<Branch[]>(`/v1/projects/${projectId}/branches`));
export const getBranchDetail = cache((branchId: string) => orNotFound(get<BranchDetail>(`/v1/branches/${branchId}`)));
export const getCommits = cache((branchId: string) => get<Commit[]>(`/v1/branches/${branchId}/commits`));
/** The id comes from the URL, so anything that isn't a UUID is simply not found. */
export const getCommit = cache((commitId: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(commitId)) notFound();
  return orNotFound(get<CommitDetail>(`/v1/commits/${commitId}`));
});

export const getBranchByName = cache(async (projectId: string, name: string) => {
  const branch = (await getBranches(projectId)).find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  if (!branch) notFound();
  return branch;
});

export const getReleases = cache((projectId: string) => get<Release[]>(`/v1/projects/${projectId}/releases`));
export const getRelease = cache((projectId: string, number: number) =>
  orNotFound(get<ReleaseDetail>(`/v1/projects/${projectId}/releases/${number}`)),
);

export const getReleaseRequests = cache((projectId: string) => get<ReleaseRequestSummary[]>(`/v1/projects/${projectId}/release-requests`));
export const getReleaseRequest = cache((id: string) => orNotFound(get<ReleaseRequestDetail>(`/v1/release-requests/${id}`)));
export const getReleaseRequestByNumber = cache(async (projectId: string, number: number) => {
  const summary = (await getReleaseRequests(projectId)).find((request) => request.number === number);
  if (!summary) notFound();
  return getReleaseRequest(summary.id);
});

export const getMembers = cache((projectId: string) => get<Member[]>(`/v1/projects/${projectId}/members`));
export const getApprovalRules = cache((projectId: string) => get<ApprovalRules>(`/v1/projects/${projectId}/approval-rules`));
export const getEvents = cache((projectId: string) => get<ProjectEvent[]>(`/v1/projects/${projectId}/events?order=desc&limit=20`));

/** A positive integer from a URL segment, or the not-found page. */
export function parseNumber(value: string): number {
  const number = Number(value.replace(/^v/i, ''));
  if (!Number.isInteger(number) || number < 1) notFound();
  return number;
}
