'use client';

import { useOptimistic, useTransition } from 'react';
import { setFavorite } from '../../app/(product)/actions';
import { StarIcon } from '../icons';

/** Adds a file to the viewer's own favorites in this project, wherever the file appears. */
export function FavoriteButton({ projectId, itemId, favorite, name }: { projectId: string; itemId: string; favorite: boolean; name: string }) {
  const [shown, setShown] = useOptimistic(favorite);
  const [pending, start] = useTransition();
  const label = shown ? `Remove ${name} from favorites` : `Add ${name} to favorites`;
  return (
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
          await setFavorite(projectId, itemId, !shown);
        })
      }
    >
      <StarIcon className="icon" />
    </button>
  );
}
