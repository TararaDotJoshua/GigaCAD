import type { Tone } from '../../lib/describe';

/** A state badge. The tone comes from lib/describe.ts so each state always looks the same. */
export function StatusBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
