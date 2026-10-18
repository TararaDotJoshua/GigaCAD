'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ProblemPanel } from '../../../../../../components/product/ProblemPanel';
import { dashboardPath } from '../../../../../../lib/hosts';

// Most often an autosave: they're cleared when the next version on their branch is committed.
export default function NotFound() {
  const [, owner, project] = usePathname().split('/');
  return (
    <ProblemPanel
      title="This snapshot is gone"
      home={dashboardPath()}
      action={
        owner && project ? (
          <Link href={`/${owner}/${project}/branches`} className="btn btn-primary">
            Branches
          </Link>
        ) : null
      }
    >
      <p>
        There’s no version or autosave at this address. Autosaves are temporary: they’re cleared when the next version on their branch is committed, which
        includes their changes. Open the branch to see its latest version.
      </p>
    </ProblemPanel>
  );
}
