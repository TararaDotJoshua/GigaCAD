import type { DirectoryParams } from '../../../../../../components/product/ProjectDirectory';
import { currentPath } from '../../../../../../lib/current-path';
import { decodeSegments, folderFromUrl } from '../../../../../../lib/paths';
import type { ProjectParams } from '../../layout';
import { ProjectFilesPage } from '../../ProjectFilesPage';

type TreeParams = ProjectParams & { path: string[] };

export async function generateMetadata({ params }: { params: Promise<TreeParams> }) {
  const { owner, project, path } = await params;
  // Metadata gets its segments already decoded, unlike the page, so a folder named `a%2Fb` would
  // read as `a/b`. The address as requested decodes the same way the page does.
  const requested = folderFromUrl((await currentPath()) ?? '');
  return { title: `${requested ?? path.join('/')} · ${owner}/${project}` };
}

/** A folder in the project directory: a root folder, or inside Branches or Releases. */
export default async function ProjectFolder({ params, searchParams }: { params: Promise<TreeParams>; searchParams: Promise<DirectoryParams> }) {
  const [{ owner, project: slug, path }, query] = await Promise.all([params, searchParams]);
  return <ProjectFilesPage owner={owner} slug={slug} path={decodeSegments(path)} params={query} />;
}
