import { redirect } from 'next/navigation';
import type { DirectoryParams } from '../../../../../components/product/ProjectDirectory';
import { treePath } from '../../../../../lib/paths';
import { getProject } from '../../../../../lib/product';
import type { ProjectParams } from '../layout';
import { ProjectFilesPage } from '../ProjectFilesPage';

export async function generateMetadata({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project } = await params;
  if (!(await getProject(owner, project).catch(() => null))) return { title: 'Not found' };
  return { title: `${owner}/${project}` };
}

export default async function ProjectFiles({
  params,
  searchParams,
}: {
  params: Promise<ProjectParams>;
  searchParams: Promise<DirectoryParams & { release?: string; forked?: string; star?: string }>;
}) {
  const [{ owner, project: slug }, { release, forked, star, ...query }] = await Promise.all([params, searchParams]);
  // Older links chose a release on this page; releases are folders now.
  if (release && /^v?\d+$/i.test(release)) redirect(treePath(owner, slug, `Releases/v${release.replace(/^v/i, '')}`));
  return <ProjectFilesPage owner={owner} slug={slug} path="" params={query} justForked={forked === '1'} finishStar={star === '1'} />;
}
