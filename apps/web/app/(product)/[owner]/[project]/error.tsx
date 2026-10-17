'use client';

import { LoadError } from '../../../../components/product/LoadError';

export default function ProjectError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <LoadError reset={reset} />;
}
