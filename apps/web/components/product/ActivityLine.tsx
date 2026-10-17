import Link from 'next/link';
import type { Line } from '../../lib/describe';

/** One activity sentence, with links to the branch, request, release, or version it names. */
export function ActivityLine({ line }: { line: Line }) {
  return (
    <span>
      {line.map((part, index) =>
        typeof part === 'string' ? (
          part
        ) : (
          <Link key={index} href={part.href} className={part.mono ? 'mono' : undefined}>
            {part.text}
          </Link>
        ),
      )}
    </span>
  );
}
