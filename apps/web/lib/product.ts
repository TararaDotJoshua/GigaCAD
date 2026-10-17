import { HANDLE_PATTERN, isPlaceholderHandle, isReservedHandle } from '@gigacad/core';
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
  type DeletedProject,
  type DirectoryFile,
  type DirectoryItem,
  type DirectoryListing,
  type EntryDetail,
  type FilePage,
  type ProjectTag,
  type Commit,
  type Member,
  type PublicMember,
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
import { currentPath, loginPath } from './current-path';
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
export const getExplore = cache((q: string, sort: 'stars' | 'recent', offset = 0, limit = 30) =>
  get<ProjectCard[]>(`/v1/explore?${new URLSearchParams({ sort, ...(q ? { q } : {}), offset: String(offset), limit: String(limit) })}`),
);
export const getUserPage = cache((handle: string) => orNotFound(get<UserPage>(`/v1/users/${encodeURIComponent(handle)}`)));
export const getUserStars = cache((handle: string) => orNotFound(get<ProjectCard[]>(`/v1/users/${encodeURIComponent(handle)}/stars`)));
/**
 * Thumbnail links for a project's files, and which are still being rendered. With a release
 * number, the thumbnails drawn from the exports that release was made with. They're a nicety,
 * so a failure shows file glyphs instead of an error.
 */
export async function getThumbnailLinks(projectId: string, sha256s: readonly string[], releaseNumber?: number): Promise<ThumbnailLinks> {
  if (sha256s.length === 0) return { thumbnails: {}, pending: [] };
  try {
    const links = await apiRequest<ThumbnailLinks>(await getAccessToken(), `/v1/projects/${projectId}/thumbnails`, {
      method: 'POST',
      body: JSON.stringify({ sha256s: [...new Set(sha256s)].slice(0, 1000), ...(releaseNumber ? { releaseNumber } : {}) }),
    });
    return { thumbnails: links.thumbnails, pending: links.pending ?? [] };
  } catch {
    return { thumbnails: {}, pending: [] };
  }
}
export const getThumbnails = async (projectId: string, sha256s: readonly string[], releaseNumber?: number) => (await getThumbnailLinks(projectId, sha256s, releaseNumber)).thumbnails;
/**
 * STEP and STL exports of a project's SolidWorks files, by file hash. With a release number,
 * the exports that release was made with. Like thumbnails, a failure just leaves them out.
 */
export async function getFileExports(projectId: string, sha256s: readonly string[], releaseNumber?: number): Promise<Record<string, FileExport[]>> {
  if (sha256s.length === 0) return {};
  try {
    const result = await apiRequest<{ exports: Record<string, FileExport[]> }>(await getAccessToken(), `/v1/projects/${projectId}/exports/lookup`, {
      method: 'POST',
      body: JSON.stringify({ sha256s: [...new Set(sha256s)].slice(0, 1000), ...(releaseNumber ? { releaseNumber } : {}) }),
    });
    return result.exports;
  } catch {
    return {};
  }
}
export const getBilling = cache(() => get<Billing>('/v1/me/billing'));
export const getMyProjects = cache(() => get<Project[]>('/v1/projects'));

/** One request per project per page render, shared by getProject and findProject. */
const fetchProject = cache((owner: string, slug: string) => get<Project>(`/v1/users/${encodeURIComponent(owner)}/projects/${encodeURIComponent(slug)}`));

/** A project, or null when it's missing or private to this viewer. Other failures (a server error, say) still throw. */
export const findProject = (owner: string, slug: string) =>
  fetchProject(owner, slug).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });

export const getProject = cache(async (owner: string, slug: string) => {
  try {
    return await fetchProject(owner, slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // Private projects look missing to outsiders. A signed-out visitor may just need to log in,
      // unless there's no such person, when no account would help. Keep the whole path (a branch,
      // a release, a folder), not just the project.
      if (!(await getAccessToken()) && (await handleTaken(owner))) redirect(`${await loginPath((await currentPath()) ?? `/${owner}/${slug}`)}&reason=private`);
      notFound();
    }
    throw error;
  }
});

export const getBranches = cache((projectId: string) => get<Branch[]>(`/v1/projects/${projectId}/branches`));
export const getBranchDetail = cache((branchId: string) => orNotFound(get<BranchDetail>(`/v1/branches/${branchId}`)));
export const getCommits = cache((branchId: string) => get<Commit[]>(`/v1/branches/${branchId}/commits`));
/** The id comes from the URL, so anything that isn't a UUID is simply not found. */
export const getCommit = cache(async (commitId: string) => {
  // Async, so a bad id rejects the promise like any other miss instead of throwing on the call.
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

type RebuildMessage = { level: 'info' | 'warning' | 'error'; message: string; path?: string };

/** Every message of a request's rebuild report, most severe first, read a page (of up to 1,000) at a time. */
export const getRebuildReport = cache(async (requestId: string) => {
  const messages: RebuildMessage[] = [];
  let total = 0;
  do {
    const page = await get<{ total: number; messages: RebuildMessage[] }>(`/v1/release-requests/${requestId}/rebuild-report?offset=${messages.length}&limit=1000`);
    total = page.total;
    if (page.messages.length === 0) break;
    messages.push(...page.messages);
  } while (messages.length < total);
  return { total, messages };
});
export const getDeletedProjects = cache(() => get<DeletedProject[]>('/v1/me/deleted-projects'));
/** Members with ids and roles, for the project's own members. Outsiders get `PublicMember`s; see `getVisibleMembers`. */
export const getMembers = cache((projectId: string) => get<Member[]>(`/v1/projects/${projectId}/members`));
/** Members as the viewer may see them: full `Member`s for members, handles only for everyone else. */
export const getVisibleMembers = cache((projectId: string) => get<(Member | PublicMember)[]>(`/v1/projects/${projectId}/members`));
/** Whether a member came with an id and role, which only the project's own members get. */
export const isFullMember = (member: Member | PublicMember): member is Member => 'userId' in member;
export const getApprovalRules = cache((projectId: string) => get<ApprovalRules>(`/v1/projects/${projectId}/approval-rules`));
export const getEvents = cache((projectId: string, limit = 20, before?: string) =>
  get<ProjectEvent[]>(`/v1/projects/${projectId}/events?order=desc&limit=${limit}${before && /^\d+$/.test(before) ? `&before=${before}` : ''}`),
);

export interface FileQuery {
  sort?: 'name' | 'modified' | 'size';
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

const fileQuery = (query: object) =>
  new URLSearchParams(Object.entries(query).flatMap(([key, value]) => (value === undefined || value === '' || value === false ? [] : [[key, String(value)]])));

/** Cached by the query string, so a page and its title asking for the same folder share one request. */
const fetchDirectory = cache((projectId: string, query: string) => get<DirectoryListing>(`/v1/projects/${projectId}/directory?${query}`));

/** One folder of the project directory, by its path from the root. A folder that doesn't exist is the not-found page. */
export const getDirectory = (projectId: string, path: string, query: FileQuery = {}) => orNotFound(fetchDirectory(projectId, fileQuery({ path, ...query }).toString()));

/** The same folder, or null when it doesn't exist. Other failures (a server error, say) still throw. */
export const findDirectory = (projectId: string, path: string, query: FileQuery = {}) =>
  fetchDirectory(projectId, fileQuery({ path, ...query }).toString()).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });
export const searchFiles = cache(
  (projectId: string, query: FileQuery & { q?: string; tags?: string; favorites?: boolean; area?: 'root' | 'branch' | 'release'; under?: string; history?: boolean }) =>
    get<FilePage<DirectoryFile>>(`/v1/projects/${projectId}/files?${fileQuery(query)}`),
);
/** Root files that serve as the project's readme, best first. */
const README_NAMES = ['readme.md', 'readme.txt'];
export const MAX_README_BYTES = 512 * 1024;

/** A README's text, or, when it's over MAX_README_BYTES, just the file, so the page can say it's too large to show. */
export type Readme = { file: DirectoryFile; tooLarge: false; markdown: boolean; text: string } | { file: DirectoryFile; tooLarge: true };

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
    if (!file) return null;
    if (file.size > MAX_README_BYTES) return { file, tooLarge: true };
    const plan = await apiRequest<{ downloads: { sha256: string; url: string }[] }>(await getAccessToken(), `/v1/projects/${projectId}/blobs/downloads`, {
      method: 'POST',
      body: JSON.stringify({ sha256s: [file.blob] }),
    });
    const url = plan.downloads[0]?.url;
    if (!url) return null;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return { file, tooLarge: false, markdown: file.name.toLowerCase().endsWith('.md'), text: await response.text() };
  } catch {
    return null;
  }
}

/** Text files a root file's page shows inline, beside Markdown. */
const TEXT_FILE = /\.(txt|text|csv|tsv|json|ya?ml|xml|ini|cfg|conf|toml|log|gcode|nc|ngc)$/i;
export const isTextFile = (name: string) => TEXT_FILE.test(name);
export const isMarkdownFile = (name: string) => /\.(md|markdown)$/i.test(name);

/** A small text file's contents, for showing it on its page; null past MAX_README_BYTES or on any failure. */
export async function getFileText(projectId: string, sha256: string, size: number): Promise<string | null> {
  if (size > MAX_README_BYTES) return null;
  try {
    const plan = await apiRequest<{ downloads: { sha256: string; url: string }[] }>(await getAccessToken(), `/v1/projects/${projectId}/blobs/downloads`, {
      method: 'POST',
      body: JSON.stringify({ sha256s: [sha256] }),
    });
    const url = plan.downloads[0]?.url;
    const response = url ? await fetch(url, { cache: 'no-store' }) : null;
    return response?.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/**
 * The project files a README links to or embeds, by the paths it names, like `Docs/notes.txt`,
 * `photos/bench.jpg` or `Releases/v2/clip.mp4`. Paths that aren't files, like folders, are left
 * out, and so is anything past the first 50. Images and videos load through mediaPath, so no
 * storage link is made here.
 */
export async function getReadmeFiles(projectId: string, paths: readonly string[]): Promise<Record<string, DirectoryFile>> {
  const files = await Promise.all(
    paths.slice(0, 50).map(async (path) => {
      const name = path.slice(path.lastIndexOf('/') + 1);
      // Search lists each file once, at its best place, so a file also in a newer release or a branch
      // wouldn't come back at the path the README names. Searching inside that folder, released and
      // archived branches included, finds it there.
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      try {
        const matches = (await searchFiles(projectId, { q: name, limit: 100, ...(folder ? { under: folder, history: true } : {}) })).entries.filter(
          (file) => file.path.toLowerCase() === path.toLowerCase(),
        );
        return [path, matches.find((file) => file.path === path) ?? matches[0]] as const;
      } catch {
        return [path, undefined] as const;
      }
    }),
  );
  return Object.fromEntries(files.flatMap(([path, file]) => (file ? [[path, file]] : [])));
}

export const getTags = cache((projectId: string) => get<ProjectTag[]>(`/v1/projects/${projectId}/tags`));
export const getRootFolders = cache((projectId: string) => get<{ id: string; path: string }[]>(`/v1/projects/${projectId}/directory/folders`));
/** A root file or folder, or null when there's none with that id (it may have been deleted). */
export const findEntry = cache(async (projectId: string, entryId: string): Promise<EntryDetail | null> => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entryId)) return null;
  try {
    return await get<EntryDetail>(`/v1/projects/${projectId}/directory/entries/${entryId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
});
export const getEntry = cache(async (projectId: string, entryId: string) => (await findEntry(projectId, entryId)) ?? notFound());

/** The largest number the database stores for a release or request. */
const MAX_NUMBER = 2_147_483_647;

/** A positive integer from a URL segment, or the not-found page. */
export function parseNumber(value: string): number {
  const number = Number(value.replace(/^v/i, ''));
  if (!Number.isInteger(number) || number < 1 || number > MAX_NUMBER) notFound();
  return number;
}

/** Whether a handle already belongs to someone, for suggesting a free one. */
async function handleTaken(handle: string): Promise<boolean> {
  try {
    await get(`/v1/users/${encodeURIComponent(handle)}`);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    throw error;
  }
}

/** A free handle made from an email address's name part, like `jo-smith` for jo.smith@example.com. */
export async function suggestHandle(email: string | null): Promise<string> {
  const base = (email?.split('@')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34)
    .replace(/-+$/, '');
  if (!base || !HANDLE_PATTERN.test(base)) return '';
  for (const candidate of [base, ...[2, 3, 4, 5].map((n) => `${base}-${n}`)]) {
    if (isReservedHandle(candidate) || isPlaceholderHandle(candidate)) continue;
    if (!(await handleTaken(candidate))) return candidate;
  }
  return '';
}
