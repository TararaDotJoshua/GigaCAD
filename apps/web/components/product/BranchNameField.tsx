'use client';

import { BRANCH_NAME_HTML_PATTERN, branchNameProblem, MAX_BRANCH_NAME_LENGTH } from '@gigacad/core';
import { useState } from 'react';

/** The new-branch name, checked as you type with the same rules and words as the API. */
export function BranchNameField() {
  const [value, setValue] = useState('');
  const problem = value ? branchNameProblem(value) : null;
  return (
    <label className="field">
      <span>Name</span>
      <input
        name="name"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          const next = event.target.value && branchNameProblem(event.target.value);
          event.target.setCustomValidity(next ? `${next}.` : '');
        }}
        required
        maxLength={MAX_BRANCH_NAME_LENGTH}
        pattern={BRANCH_NAME_HTML_PATTERN}
        placeholder="gripper-redesign"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={problem ? true : undefined}
        aria-describedby="branch-name-hint"
      />
      <small id="branch-name-hint" className={problem ? 'field-hint is-error' : 'field-hint'}>
        {problem ? `${problem}.` : 'Letters, digits, dots, dashes, and underscores.'}
      </small>
    </label>
  );
}
