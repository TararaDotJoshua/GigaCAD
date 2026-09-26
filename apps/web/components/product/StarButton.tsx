'use client';

import Link from 'next/link';
import { useOptimistic, useTransition } from 'react';
import { setStar } from '../../app/(product)/actions';
import { StarIcon } from '../icons';

/** Stars a project, showing the count. Signed-out visitors are sent to log in. */
export function StarButton({ projectId, starred, count, signedIn, next }: { projectId: string; starred: boolean; count: number; signedIn: boolean; next: string }) {
  const [state, setOptimistic] = useOptimistic({ starred, count });
  const [pending, start] = useTransition();
  const label = `${state.count} ${state.count === 1 ? 'star' : 'stars'}`;
  if (!signedIn) {
    return (
      <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn btn-secondary star-button" title="Log in to star">
        <StarIcon className="icon" />
        Star <span className="star-count">{state.count}</span>
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={`btn btn-secondary star-button${state.starred ? ' is-starred' : ''}`}
      aria-pressed={state.starred}
      aria-label={`${state.starred ? 'Unstar' : 'Star'} this project, ${label}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          setOptimistic({ starred: !state.starred, count: state.count + (state.starred ? -1 : 1) });
          await setStar(projectId, !state.starred);
        })
      }
    >
      <StarIcon className="icon" />
      {state.starred ? 'Starred' : 'Star'} <span className="star-count">{state.count}</span>
    </button>
  );
}
