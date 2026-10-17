import Link from 'next/link';
import { ProblemPanel } from '../../../../components/product/ProblemPanel';
import { currentPath } from '../../../../lib/current-path';
import { dashboardPath } from '../../../../lib/hosts';
import { projectPath } from '../../../../lib/paths';
import { getProject } from '../../../../lib/product';

// Missing branches, releases, requests, folders, and files inside a project that exists.
export default async function NotFound() {
  // The layout already loaded the project for this address, so this read comes from the request cache.
  const [, owner, slug] = ((await currentPath()) ?? '').split(/[?#]/)[0]!.split('/').map(decodeURIComponent);
  const project = owner && slug ? await getProject(owner, slug).catch(() => null) : null;
  return (
    <ProblemPanel
      title="Not found"
      home={dashboardPath()}
      action={
        project && (
          <Link href={projectPath(project.ownerHandle, project.slug)} className="btn btn-primary">
            Back to {project.name}
          </Link>
        )
      }
    >
      <p>There’s nothing at this address in the project. It may have been renamed, archived, or deleted.</p>
    </ProblemPanel>
  );
}
