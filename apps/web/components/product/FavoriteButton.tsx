'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { setFavorite } from '../../app/(product)/actions';
import { safeAction } from '../../lib/safe-action';
import { StarIcon } from '../icons';

/** Adds a file to the viewer's own favorites in this project, wherever the file appears. */
export function FavoriteButton({ projectId, itemId, favorite, name }: { projectId: string; itemId: string; favorite: boolean; name: string }) {
  const [shown, setShown] = useOptimistic(favorite);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const label = shown ? `Remove ${name} from favorites` : `Add ${name} to favorites`;
  return (
    <>
      <button
        type="button"
        className={`icon-button favorite-button${shown ? ' is-favorite' : ''}`}
        aria-pressed={shown}
        aria-label={label}
        title={label}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setShown(!shown);
            setError((await safeAction(() => setFavorite(projectId, itemId, !shown))).error ?? '');
          })
        }
      >
        <StarIcon className="icon" />
      </button>
      {error && (
        <span className="form-status is-error download-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
