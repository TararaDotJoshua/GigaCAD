'use client';

import { PageError } from '../../components/product/PageError';

// Errors on pages that bring their own frame (Explore, profiles). Keeps the work pane's look without the sidebar.
export default function ProductError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="shell">
      <main id="main" className="shell-pane">
        <PageError reset={reset} />
      </main>
    </div>
  );
}
