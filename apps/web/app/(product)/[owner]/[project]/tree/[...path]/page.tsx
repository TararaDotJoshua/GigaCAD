import type { DirectoryParams } from '../../../../../../components/product/ProjectDirectory';
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

export async function generateMetadata({ params }: { params: Promise<TreeParams> }) {
  const { owner, project, path } = await params;
  return { title: `${folderPath(path)} · ${owner}/${project}` };
}

/** A folder in the project directory: a root folder, or inside Branches or Releases. */
export default async function ProjectFolder({ params, searchParams }: { params: Promise<TreeParams>; searchParams: Promise<DirectoryParams> }) {
  const [{ owner, project: slug, path }, query] = await Promise.all([params, searchParams]);
  return <ProjectFilesPage owner={owner} slug={slug} path={folderPath(path)} params={query} />;
}
