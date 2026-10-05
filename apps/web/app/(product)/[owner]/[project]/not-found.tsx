import { ProblemPanel } from '../../../../components/product/ProblemPanel';
import { dashboardPath } from '../../../../lib/hosts';

// Missing branches, releases, requests, folders, and files inside a project that exists.
export default function NotFound() {
  return (
    <ProblemPanel title="Not found" home={dashboardPath()}>
      <p>There’s nothing at this address in the project. It may have been renamed, archived, or deleted.</p>
    </ProblemPanel>
  );
}
