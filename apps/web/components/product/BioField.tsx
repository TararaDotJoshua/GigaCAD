'use client';

import { useRef, useState } from 'react';
import { characterCount, limitEdit } from '../../lib/text-limit';

export const BIO_MAX = 160;
/** The count is announced only near the limit, not on every keystroke. */
const ANNOUNCE_FROM = 20;

/** The profile bio, with a count of the characters left. */
export function BioField({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const field = useRef<HTMLTextAreaElement>(null);
  const left = BIO_MAX - characterCount(value);
  const words = left === 1 ? '1 character left' : `${left} characters left`;
  return (
    <label className="field">
      <span>
        Bio <em>optional</em>
      </span>
      <textarea
        ref={field}
        name="bio"
        rows={3}
        value={value}
        onChange={(event) => {
          const next = limitEdit(value, event.target.value, BIO_MAX);
          setValue(next.value);
          // A cut edit puts the caret back where the typing was, not at the end.
          const caret = next.caret;
          if (caret !== null) requestAnimationFrame(() => field.current?.setSelectionRange(caret, caret));
        }}
        aria-describedby="bio-count"
      />
      <small className="field-hint" id="bio-count">
        {words}
      </small>
      <span className="sr-only" aria-live="polite">
        {left <= ANNOUNCE_FROM ? words : ''}
      </span>
    </label>
  );
}
