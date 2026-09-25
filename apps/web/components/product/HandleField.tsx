'use client';

import { HANDLE_PATTERN, isReservedHandle } from '@gigacad/core';
import { useState } from 'react';

/** The handle input, checked as you type with the same rules as the API. */
export function HandleField({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const problem = !value
    ? ''
    : !HANDLE_PATTERN.test(value)
      ? 'Use 1-39 lowercase letters, digits, or dashes, not starting or ending with a dash.'
      : isReservedHandle(value)
        ? 'That handle is reserved. Pick another.'
        : '';
  return (
    <label className="field">
      <span>Handle</span>
      <input
        name="handle"
        value={value}
        onChange={(event) => {
          const next = event.target.value.toLowerCase();
          setValue(next);
          event.target.setCustomValidity(
            next && (!HANDLE_PATTERN.test(next) || isReservedHandle(next)) ? 'Choose a valid handle' : '',
          );
        }}
        autoComplete="username"
        spellCheck={false}
        required
      />
      <small className={problem ? 'field-hint is-error' : 'field-hint'}>
        {problem || `Your projects will live at app.gigacad.site/${value || 'handle'}/…`}
      </small>
    </label>
  );
}
