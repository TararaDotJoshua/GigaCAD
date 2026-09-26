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
  type DirectoryFile,
  type DirectoryItem,
  type DirectoryListing,
  type EntryDetail,
  type FilePage,
  type ProjectTag,
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
import { mediaKind, type EmbeddedFile } from './readme';
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

export interface FileQuery {
  sort?: 'name' | 'modified' | 'size';
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

const fileQuery = (query: object) =>
  new URLSearchParams(Object.entries(query).flatMap(([key, value]) => (value === undefined || value === '' || value === false ? [] : [[key, String(value)]])));

/** One folder of the project directory, by its path from the root. A folder that doesn't exist is the not-found page. */
export const getDirectory = cache((projectId: string, path: string, query: FileQuery = {}) =>
  orNotFound(get<DirectoryListing>(`/v1/projects/${projectId}/directory?${fileQuery({ path, ...query })}`)),
);
export const searchFiles = cache(
  (projectId: string, query: FileQuery & { q?: string; tags?: string; favorites?: boolean; area?: 'root' | 'branch' | 'release' }) =>
    get<FilePage<DirectoryFile>>(`/v1/projects/${projectId}/files?${fileQuery(query)}`),
);
/** Root files that serve as the project's readme, best first. */
const README_NAMES = ['readme.md', 'readme.txt'];
const MAX_README_BYTES = 512 * 1024;

export interface Readme {
  file: DirectoryFile;
  markdown: boolean;
  text: string;
}

/**
 * The README at the project root, from the files already listed or, when the root spans
 * several pages, a search. Like thumbnails, it's a nicety: a failure leaves it out.
 */
export async function getReadme(projectId: string, listed: readonly DirectoryItem[], complete: boolean): Promise<Readme | null> {
  const pick = (files: readonly DirectoryItem[]) =>
    files
      .filter((entry): entry is DirectoryFile => entry.kind === 'file' && entry.location.area === 'root' && entry.path === entry.name)
      .filter((file) => README_NAMES.includes(file.name.toLowerCase()))
      .sort((a, b) => README_NAMES.indexOf(a.name.toLowerCase()) - README_NAMES.indexOf(b.name.toLowerCase()))[0];
  try {
    const file = pick(listed) ?? (complete ? undefined : pick((await searchFiles(projectId, { q: 'readme', area: 'root', limit: 100 })).entries));
    if (!file || file.size > MAX_README_BYTES) return null;
    const plan = await apiRequest<{ downloads: { sha256: string; url: string }[] }>(await getAccessToken(), `/v1/projects/${projectId}/blobs/downloads`, {
      method: 'POST',
      body: JSON.stringify({ sha256s: [file.blob] }),
    });
    const url = plan.downloads[0]?.url;
    if (!url) return null;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return { file, markdown: file.name.toLowerCase().endsWith('.md'), text: await response.text() };
  } catch {
    return null;
  }
}

/**
 * Links for the images and videos a README embeds, by the project paths it names, like
 * `photos/bench.jpg` or `Releases/v2/clip.mp4`. Files that aren't there are left out.
 */
export async function getReadmeMedia(projectId: string, paths: readonly string[]): Promise<Record<string, EmbeddedFile>> {
  try {
    const files = await Promise.all(
      paths.slice(0, 50).map(async (path) => {
        const name = path.slice(path.lastIndexOf('/') + 1);
        const matches = (await searchFiles(projectId, { q: name, limit: 100 })).entries.filter((file) => file.path.toLowerCase() === path.toLowerCase());
        return [path, matches.find((file) => file.path === path) ?? matches[0]] as const;
      }),
    );
    const found = files.flatMap(([path, file]) => {
      const kind = file && mediaKind(file.name);
      return file && kind ? [{ path, file, kind }] : [];
    });
    if (found.length === 0) return {};
    const plan = await apiRequest<{ downloads: { sha256: string; url: string }[] }>(await getAccessToken(), `/v1/projects/${projectId}/blobs/downloads`, {
      method: 'POST',
      body: JSON.stringify({
        sha256s: found.map(({ file }) => file.blob),
        filenames: Object.fromEntries(found.map(({ file }) => [file.blob, file.name])),
        inline: true,
      }),
    });
    const urls = new Map(plan.downloads.map((download) => [download.sha256, download.url]));
    return Object.fromEntries(found.flatMap(({ path, file, kind }) => (urls.has(file.blob) ? [[path, { url: urls.get(file.blob)!, kind }]] : [])));
  } catch {
    return {};
  }
}

export const getTags = cache((projectId: string) => get<ProjectTag[]>(`/v1/projects/${projectId}/tags`));
export const getRootFolders = cache((projectId: string) => get<{ id: string; path: string }[]>(`/v1/projects/${projectId}/directory/folders`));
export const getEntry = cache((projectId: string, entryId: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entryId)) notFound();
  return orNotFound(get<EntryDetail>(`/v1/projects/${projectId}/directory/entries/${entryId}`));
});

/** A positive integer from a URL segment, or the not-found page. */
export function parseNumber(value: string): number {
  const number = Number(value.replace(/^v/i, ''));
  if (!Number.isInteger(number) || number < 1) notFound();
  return number;
}
