'use client';

import { LoadError } from '../../../components/product/LoadError';

export default function AccountError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <LoadError reset={reset} />;
}
