'use client';

import { useState } from 'react';

export const BIO_MAX = 160;

/** The profile bio, with a count of the characters left. */
export function BioField({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const left = BIO_MAX - value.length;
  return (
    <label className="field">
      <span>
        Bio <em>optional</em>
      </span>
      <textarea name="bio" rows={3} maxLength={BIO_MAX} value={value} onChange={(event) => setValue(event.target.value)} />
      <small className="field-hint" aria-live="polite">
        {left === 1 ? '1 character left' : `${left} characters left`}
      </small>
    </label>
  );
}
