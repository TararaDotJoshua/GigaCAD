'use client';

import { useEffect, useRef, useState, useTransition, type CSSProperties } from 'react';
import { setFileTags } from '../../app/(product)/actions';
import type { Tag } from '../../lib/api';
import { safeAction } from '../../lib/safe-action';
import { useDismissDetails } from '../../lib/use-dismiss';
import { TagIcon } from '../icons';

/**
 * Chooses a file's tags from the project's tags. Tags stay with the file in every branch and release.
 * Closing it without saving, with Cancel, Escape, or a click elsewhere, puts back the saved tags.
 */
export function TagPicker({ projectId, itemId, name, tags, selected }: { projectId: string; itemId: string; name: string; tags: Tag[]; selected: Tag[] }) {
  const [chosen, setChosen] = useState(() => new Set(selected.map((tag) => tag.id)));
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  // Placed against the viewport, so the table's scrolling and rounded corners don't clip it.
  const [place, setPlace] = useState<CSSProperties>();
  useDismissDetails(place !== undefined, menu);

  // A save refreshes the page with the new tags; start from them.
  const saved = selected.map((tag) => tag.id).join();
  useEffect(() => setChosen(new Set(saved ? saved.split(',') : [])), [saved]);

  const dismiss = (restoreFocus = false) => {
    menu.current?.removeAttribute('open');
    if (restoreFocus) menu.current?.querySelector('summary')?.focus();
  };

  useEffect(() => {
    if (!place) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      dismiss(true);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', escape);
    };
  }, [place]);

  return (
    <details
      ref={menu}
      className="menu tag-picker"
      onToggle={(event) => {
        if (!event.currentTarget.open) {
          // Unsaved ticks don't outlive the picker.
          setChosen(new Set(selected.map((tag) => tag.id)));
          setError('');
          return setPlace(undefined);
        }
        const button = event.currentTarget.querySelector('summary')!.getBoundingClientRect();
        const right = Math.max(8, window.innerWidth - button.right);
        // Opens upward only when there's too little room below and more above. Either way it's no taller
        // than the room on its own side, so Save stays on screen.
        const above = button.top - 14;
        const below = window.innerHeight - button.bottom - 14;
        setPlace(
          button.bottom + 320 > window.innerHeight && above > below
            ? { position: 'fixed', right, bottom: window.innerHeight - button.top + 6, maxHeight: Math.max(120, above), marginTop: 0 }
            : { position: 'fixed', right, top: button.bottom, maxHeight: Math.max(120, below), marginTop: 6 },
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
              onClick={() => {
                const before = new Set(selected.map((tag) => tag.id));
                // Saving the same tags would only add a line to the activity.
                if (chosen.size === before.size && [...chosen].every((id) => before.has(id))) return dismiss(true);
                start(async () => {
                  const result = await safeAction(() => setFileTags(projectId, itemId, [...chosen]));
                  setError(result.error ?? '');
                  if (!result.error) dismiss(true);
                });
              }}
            >
              {pending ? 'Saving…' : 'Save tags'}
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => dismiss(true)}>
              Cancel
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
