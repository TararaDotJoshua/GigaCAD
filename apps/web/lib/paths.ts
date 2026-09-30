/** URLs for product pages: app.gigacad.site/<owner>/<project>/... */
export function projectPath(owner: string, slug: string, ...rest: (string | number)[]): string {
  return ['', owner, slug, ...rest.map((part) => encodeURIComponent(String(part)))].join('/');
}

export const branchPath = (owner: string, slug: string, branch: string) => projectPath(owner, slug, 'branches', branch);
export const releaseRequestPath = (owner: string, slug: string, number: number) => projectPath(owner, slug, 'release-requests', number);
export const releasePath = (owner: string, slug: string, number: number) => projectPath(owner, slug, 'releases', number);
export const commitPath = (owner: string, slug: string, id: string) => projectPath(owner, slug, 'commits', id);

/** A folder in the project directory, like `Designs/Brackets` or `Branches/main/parts`. The root is the project page. */
export const treePath = (owner: string, slug: string, path: string) =>
  path ? projectPath(owner, slug, 'tree', ...path.split('/').filter(Boolean)) : projectPath(owner, slug);
/** A root file or folder's own page: revisions, tags, rename, move. */
export const entryPath = (owner: string, slug: string, entryId: string) => projectPath(owner, slug, 'entries', entryId);

/** The first of `slug`, `slug-2`, `slug-3`, … that isn't in `taken`, kept within the 100-character limit. */
export function freeSlug(slug: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(slug)) return slug;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${slug.slice(0, 100 - suffix.length).replace(/[._-]+$/, '')}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** A release's files as one zip, streamed through the web app. */
export const releaseDownloadPath = (owner: string, slug: string, number: number) => projectPath(owner, slug, 'releases', number, 'download');
