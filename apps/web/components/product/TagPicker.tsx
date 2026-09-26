'use client';

import { useEffect, useRef, useState, useTransition, type CSSProperties } from 'react';
import { setFileTags } from '../../app/(product)/actions';
import type { Tag } from '../../lib/api';
import { TagIcon } from '../icons';

/** Chooses a file's tags from the project's tags. Tags stay with the file in every branch and release. */
export function TagPicker({ projectId, itemId, name, tags, selected }: { projectId: string; itemId: string; name: string; tags: Tag[]; selected: Tag[] }) {
  const [chosen, setChosen] = useState(() => new Set(selected.map((tag) => tag.id)));
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  // Placed against the viewport, so the table's scrolling and rounded corners don't clip it.
  const [place, setPlace] = useState<CSSProperties>();

  useEffect(() => {
    if (!place) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      menu.current?.removeAttribute('open');
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [place]);

  return (
    <details
      ref={menu}
      className="menu tag-picker"
      onToggle={(event) => {
        if (!event.currentTarget.open) return setPlace(undefined);
        const button = event.currentTarget.querySelector('summary')!.getBoundingClientRect();
        const right = Math.max(8, window.innerWidth - button.right);
        // Opens upward when there's more room above the button than below it.
        setPlace(
          button.bottom + 320 > window.innerHeight && button.top > window.innerHeight - button.bottom
            ? { position: 'fixed', right, bottom: window.innerHeight - button.top + 6, marginTop: 0 }
            : { position: 'fixed', right, top: button.bottom, marginTop: 6 },
        );
      }}
    >
      <summary className="icon-button" aria-label={`Tags for ${name}`} title={`Tags for ${name}`}>
        <TagIcon className="icon" />
      </summary>
      <div className="menu-list tag-picker-list" style={place}>
        {tags.length === 0 ? (
          <p className="muted">Add tags to this project first, under Tags.</p>
        ) : (
          <fieldset>
            <legend className="sr-only">Tags for {name}</legend>
            {tags.map((tag) => (
              <label key={tag.id} className="choice">
                <input
                  type="checkbox"
                  checked={chosen.has(tag.id)}
                  onChange={(event) => {
                    const next = new Set(chosen);
                    if (event.target.checked) next.add(tag.id);
                    else next.delete(tag.id);
                    setChosen(next);
                  }}
                />
                <span>{tag.name}</span>
              </label>
            ))}
          </fieldset>
        )}
        {tags.length > 0 && (
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={pending}
              onClick={(event) => {
                start(async () => {
                  const result = await setFileTags(projectId, itemId, [...chosen]);
                  setError(result.error ?? '');
                  if (!result.error) menu.current?.removeAttribute('open');
                });
              }}
            >
              Save tags
            </button>
            {error && (
              <span className="form-status is-error" role="alert">
                {error}
              </span>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
