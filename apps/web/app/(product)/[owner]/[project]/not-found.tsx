import Link from 'next/link';
import { ProblemPanel } from '../../../../components/product/ProblemPanel';
import { currentPath } from '../../../../lib/current-path';
import { dashboardPath } from '../../../../lib/hosts';

// Missing branches, releases, requests, folders, and files inside a project that exists.
export default async function NotFound() {
  // The project itself is there, so the way back to its files is the first way onward.
  const [, owner, slug] = ((await currentPath()) ?? '').split(/[?#]/)[0]!.split('/');
  return (
    <ProblemPanel
      title="Not found"
      home={dashboardPath()}
      action={
        owner && slug ? (
          <Link href={`/${owner}/${slug}`} className="btn btn-primary">
            Back to the project’s files
          </Link>
        ) : undefined
      }
    >
      <p>There’s nothing at this address in the project. It may have been renamed, archived, or deleted.</p>
    </ProblemPanel>
  );
}
