'use client';

import { LoadError } from '../../../components/product/LoadError';

export default function AccountError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Account pages always need a session, so a missing one is the likely cause.
  return <LoadError reset={reset} needsSession />;
}
