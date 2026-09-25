import { LiveRefresh } from '../../../../components/product/LiveRefresh';
import { Shell } from '../../../../components/product/Shell';
import { getProject } from '../../../../lib/product';

export interface ProjectParams {
  readonly owner: string;
  readonly project: string;
}

export default async function ProjectLayout({ params, children }: { params: Promise<ProjectParams>; children: React.ReactNode }) {
  const { owner, project: slug } = await params;
  const project = await getProject(owner, slug);
  return (
    <Shell project={project}>
      <LiveRefresh projectId={project.id} />
      {children}
    </Shell>
  );
}
