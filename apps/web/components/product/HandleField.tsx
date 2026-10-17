'use client';

import { HANDLE_PATTERN, isPlaceholderHandle, isReservedHandle } from '@gigacad/core';
import { useState } from 'react';
import { APP_URL } from '../site';

/** What's wrong with a handle, by the same rules as the API, or '' when it's fine. */
function handleProblem(value: string): string {
  if (!value) return '';
  if (!HANDLE_PATTERN.test(value)) return 'Use 1-39 lowercase letters, digits, or dashes, not starting or ending with a dash.';
  if (isReservedHandle(value)) return 'That handle is reserved. Pick another.';
  if (isPlaceholderHandle(value)) return 'Choose a handle of your own.';
  return '';
}

/**
 * The handle input, checked as you type with the same rules as the API. Changing a handle
 * someone already has moves every link to their profile and projects, so it asks first.
 */
export function HandleField({ defaultValue, saved = null, projectCount = 0 }: { defaultValue: string; saved?: string | null; projectCount?: number }) {
  const [value, setValue] = useState(defaultValue);
  const problem = handleProblem(value);
  const host = new URL(APP_URL).host;
  const moving = Boolean(saved && value && !problem && value !== saved);
  return (
    <>
      <label className="field">
        <span>Handle</span>
        <input
          name="handle"
          value={value}
          onChange={(event) => {
            const next = event.target.value.toLowerCase();
            setValue(next);
            event.target.setCustomValidity(handleProblem(next) ? 'Choose a valid handle' : '');
          }}
          autoComplete="username"
          spellCheck={false}
          required
        />
        <small className={problem ? 'field-hint is-error' : 'field-hint'}>{problem || `Your projects will live at ${host}/${value || 'handle'}/…`}</small>
      </label>
      {moving && (
        <label className="choice">
          <input type="checkbox" name="confirmHandle" required />
          <span>
            Change @{saved} to @{value}. Links to {host}/{saved}
            {projectCount > 0 ? ` and your ${projectCount === 1 ? 'project' : `${projectCount} projects`} there` : ''} will stop working, and someone else could
            take @{saved}.
          </span>
        </label>
      )}
    </>
  );
}
