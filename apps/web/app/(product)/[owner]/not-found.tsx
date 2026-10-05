import { isReservedHandle } from '@gigacad/core';
import { ProblemPanel } from '../../../components/product/ProblemPanel';
import { Shell } from '../../../components/product/Shell';
import { currentPath } from '../../../lib/current-path';
import { dashboardPath } from '../../../lib/hosts';
import RootNotFound from '../../not-found';

// Missing people and projects. Private projects look missing to people who can't see them.
export default async function NotFound() {
  // Site pages like /docs/<missing> land here too; they get the site's own 404, not the product frame.
  const first = (await currentPath())?.split(/[/?]/)[1];
  if (first && isReservedHandle(first)) return <RootNotFound />;
  return (
    <Shell>
      <ProblemPanel title="Not found" home={dashboardPath()}>
        <p>There’s no project or person at this address, or it’s private and your account doesn’t have access.</p>
        <p>Check the address, or ask the owner to add you.</p>
      </ProblemPanel>
    </Shell>
  );
}
