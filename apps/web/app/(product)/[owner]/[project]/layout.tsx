import { isReservedHandle } from '@gigacad/core';
import { notFound } from 'next/navigation';
import { LiveRefresh } from '../../../../components/product/LiveRefresh';
import { Shell } from '../../../../components/product/Shell';
import { getProject } from '../../../../lib/product';

export interface ProjectParams {
  readonly owner: string;
  readonly project: string;
}

export default async function ProjectLayout({ params, children }: { params: Promise<ProjectParams>; children: React.ReactNode }) {
  const { owner, project: slug } = await params;
  // Reserved handles are site pages, like /docs. A missing /docs/<page> falls through to this
  // route, and must be a 404 rather than a sign-in redirect.
  if (isReservedHandle(owner)) notFound();
  const project = await getProject(owner, slug);
  return (
    <Shell project={project}>
      <LiveRefresh projectId={project.id} />
      {children}
    </Shell>
  );
}
