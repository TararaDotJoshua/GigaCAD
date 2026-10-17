'use client';

import { PageError } from '../../../../components/product/PageError';

export default function ProjectError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError reset={reset} />;
}
