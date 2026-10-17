'use client';

import { PageError } from '../../../components/product/PageError';

export default function AccountError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError reset={reset} />;
}
