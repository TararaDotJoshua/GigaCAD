import { notFound } from 'next/navigation';
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
  type ProjectEvent,
  type Release,
  type ReleaseDetail,
  type ReleaseRequestDetail,
  type ReleaseRequestSummary,
} from './api';
import { requireAccessToken } from './session';

/** Server-side API reads for product pages. Each is cached for the length of one request. */
async function get<T>(path: string): Promise<T> {
  return apiRequest<T>(await requireAccessToken(), path);
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
export const getBilling = cache(() => get<Billing>('/v1/me/billing'));
export const getMyProjects = cache(() => get<Project[]>('/v1/projects'));

export const getProject = cache((owner: string, slug: string) =>
  orNotFound(get<Project>(`/v1/users/${encodeURIComponent(owner)}/projects/${encodeURIComponent(slug)}`)),
);

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
