'use client';

import { useState } from 'react';

export const BIO_MAX = 160;
/** The count is announced only near the limit, not on every keystroke. */
const ANNOUNCE_FROM = 20;

/** Characters as the API and database count them: code points, so an emoji isn't counted twice for its UTF-16 halves. */
const length = (value: string) => [...value].length;

/** Cuts text to the limit at a whole character as people see it, so an emoji is never left half there. */
function fit(value: string): string {
  if (length(value) <= BIO_MAX) return value;
  let out = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) {
    if (length(out + segment) > BIO_MAX) break;
    out += segment;
  }
  return out;
}

/** The profile bio, with a count of the characters left. */
export function BioField({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const left = BIO_MAX - length(value);
  const words = left === 1 ? '1 character left' : `${left} characters left`;
  return (
    <label className="field">
      <span>
        Bio <em>optional</em>
      </span>
      <textarea name="bio" rows={3} value={value} onChange={(event) => setValue(fit(event.target.value))} aria-describedby="bio-count" />
      <small className="field-hint" id="bio-count">
        {words}
      </small>
      <span className="sr-only" aria-live="polite">
        {left <= ANNOUNCE_FROM ? words : ''}
      </span>
    </label>
  );
}
