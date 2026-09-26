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
