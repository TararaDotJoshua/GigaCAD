import { directoryPaging, type DirectoryParams } from '../../../../../../components/product/ProjectDirectory';
import { findDirectory, findProject } from '../../../../../../lib/product';
import type { ProjectParams } from '../../layout';
import { ProjectFilesPage } from '../../ProjectFilesPage';

type TreeParams = ProjectParams & { path: string[] };

/** Segments may arrive still percent-encoded; a name with a literal % stays as it is. */
function folderPath(segments: string[]): string {
  return segments
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

export async function generateMetadata({ params, searchParams }: { params: Promise<TreeParams>; searchParams: Promise<DirectoryParams> }) {
  const [{ owner, project, path }, query] = await Promise.all([params, searchParams]);
  // A missing folder, or a project that's missing or private to this viewer, 404s from the page;
  // its title says only that, without repeating the path from the address. Any other failure
  // (undefined here) isn't a "Not found": the tab keeps the folder's title over the page's error.
  const title = { title: `${folderPath(path)} · ${owner}/${project}` };
  const found = await findProject(owner, project).catch(() => undefined);
  if (found === null) return { title: 'Not found' };
  if (found === undefined) return title;
  return (await findDirectory(found.id, folderPath(path), directoryPaging(query)).catch(() => undefined)) === null ? { title: 'Not found' } : title;
}

/** A folder in the project directory: a root folder, or inside Branches or Releases. */
export default async function ProjectFolder({ params, searchParams }: { params: Promise<TreeParams>; searchParams: Promise<DirectoryParams> }) {
  const [{ owner, project: slug, path }, query] = await Promise.all([params, searchParams]);
  return <ProjectFilesPage owner={owner} slug={slug} path={folderPath(path)} params={query} />;
}
