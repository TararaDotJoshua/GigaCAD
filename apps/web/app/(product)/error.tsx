'use client';

import { ProblemPanel } from '../../components/product/ProblemPanel';
import { dashboardPath } from '../../lib/hosts';

// Errors on pages that bring their own frame (Explore, profiles). Keeps the work pane's look without the sidebar.
export default function ProductError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="shell">
      <main id="main" className="shell-pane">
        <ProblemPanel title="This page didn’t load" home={dashboardPath()} action={<button type="button" className="btn btn-primary" onClick={reset}>Try again</button>}>
          <p>Something went wrong on our side. Your files are safe. Try again in a moment.</p>
        </ProblemPanel>
      </main>
    </div>
  );
}
