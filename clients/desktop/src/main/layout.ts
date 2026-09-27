import { isAbsolute, join, relative, sep } from 'node:path';

/**
 * The GigaCAD folder mirrors the web directory:
 *
 *   ~/GigaCAD/<owner>/<project>/
 *     <root files and folders>
 *     Branches/<name>/...
 *     Releases/v<N>/...
 */
export type Area = 'folder' | 'owner' | 'project-root' | 'branches' | 'branch' | 'releases' | 'release';

export interface Location {
  readonly area: Area;
  readonly owner?: string;
  readonly project?: string;
  /** The branch name or `v<N>` for branch and release areas. */
  readonly name?: string;
  readonly releaseNumber?: number;
  /** The project folder, e.g. ~/GigaCAD/alex/robot-arm. */
  readonly projectDir?: string;
  /** The branch or release folder. */
  readonly areaDir?: string;
  /** Path inside the area (root, branch, or release), with forward slashes; '' for the area itself. */
  readonly inner: string;
  /** Path inside the project, with forward slashes, as the web directory names it. */
  readonly projectPath: string;
}

const RELEASE = /^v(\d+)$/i;

export function projectDir(folder: string, owner: string, slug: string): string {
  return join(folder, owner, slug);
}
export const branchDir = (folder: string, owner: string, slug: string, branch: string) => join(folder, owner, slug, 'Branches', branch);
export const releaseDir = (folder: string, owner: string, slug: string, number: number) => join(folder, owner, slug, 'Releases', `v${number}`);

/** Where `path` sits in the GigaCAD folder, or undefined when it's outside it. */
export function locate(folder: string, path: string): Location | undefined {
  const rel = relative(folder, path);
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined;
  const parts = rel === '' ? [] : rel.split(sep);
  if (parts.length === 0) return { area: 'folder', inner: '', projectPath: '' };
  const [owner, project, top, name, ...rest] = parts as [string, string?, string?, string?, ...string[]];
  if (project === undefined) return { area: 'owner', owner, inner: '', projectPath: '' };
  const dir = join(folder, owner, project);
  const base = { owner, project, projectDir: dir };
  const projectPath = parts.slice(2).join('/');
  if (top === undefined) return { ...base, area: 'project-root', inner: '', projectPath };

  const topKey = top.toLowerCase();
  if (topKey === 'branches' || topKey === 'releases') {
    const isBranch = topKey === 'branches';
    if (name === undefined) return { ...base, area: isBranch ? 'branches' : 'releases', inner: '', projectPath };
    const areaDir = join(dir, top, name);
    const inner = rest.join('/');
    if (isBranch) return { ...base, area: 'branch', name, areaDir, inner, projectPath };
    const match = name.match(RELEASE);
    if (!match) return { ...base, area: 'releases', inner: '', projectPath };
    return { ...base, area: 'release', name, releaseNumber: Number(match[1]), areaDir, inner, projectPath };
  }
  return { ...base, area: 'project-root', inner: parts.slice(2).join('/'), projectPath };
}

/** app.gigacad.site links, built the same way as apps/web/lib/paths.ts. */
export function projectUrl(appUrl: string, owner: string, slug: string, ...rest: (string | number)[]): string {
  return `${appUrl}${['', owner, slug, ...rest.map((part) => encodeURIComponent(String(part)))].join('/')}`;
}

export function treeUrl(appUrl: string, owner: string, slug: string, path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments.length > 0 ? projectUrl(appUrl, owner, slug, 'tree', ...segments) : projectUrl(appUrl, owner, slug);
}

/** The page for a location: its folder in the web directory (a file links to the folder holding it). */
export function webUrlFor(appUrl: string, location: Location, isFile: boolean): string | undefined {
  if (!location.owner || !location.project) return undefined;
  let path = location.projectPath;
  if (isFile) path = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return treeUrl(appUrl, location.owner, location.project, path);
}
