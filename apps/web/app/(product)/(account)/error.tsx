'use client';

import { ProblemPanel } from '../../../components/product/ProblemPanel';
import { dashboardPath } from '../../../lib/hosts';

export default function AccountError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ProblemPanel title="This page didn’t load" home={dashboardPath()} action={<button type="button" className="btn btn-primary" onClick={reset}>Try again</button>}>
      <p>Something went wrong on our side. Your files are safe. Try again in a moment.</p>
    </ProblemPanel>
  );
}
