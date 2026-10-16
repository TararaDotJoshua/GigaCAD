'use client';

import Link from 'next/link';
import { useOptimistic, useState, useTransition } from 'react';
import { setStar } from '../../app/(product)/actions';
import { safeAction } from '../../lib/safe-action';
import { StarIcon } from '../icons';

/** Stars a project, showing the count. Signed-out visitors are sent to log in. */
export function StarButton({ projectId, starred, count, signedIn, next }: { projectId: string; starred: boolean; count: number; signedIn: boolean; next: string }) {
  const [state, setOptimistic] = useOptimistic({ starred, count });
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
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
    <span className="action">
      <button
        type="button"
        className={`btn btn-secondary star-button${state.starred ? ' is-starred' : ''}`}
        aria-pressed={state.starred}
        aria-label={`${state.starred ? 'Unstar' : 'Star'} this project, ${label}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setOptimistic({ starred: !state.starred, count: state.count + (state.starred ? -1 : 1) });
            // A failure puts the star back as it was, with a word on why.
            setError((await safeAction(() => setStar(projectId, !state.starred))).error ?? '');
          })
        }
      >
        <StarIcon className="icon" />
        {state.starred ? 'Starred' : 'Star'} <span className="star-count">{state.count}</span>
      </button>
      {error && (
        <span className="form-status is-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
