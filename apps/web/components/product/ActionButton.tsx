'use client';

import { useId, useState, useTransition } from 'react';
import type { ActionState } from '../../app/(product)/actions';

/**
 * A button that runs one server action (already bound to its arguments), with the result
 * shown next to it. With `confirm`, the first click asks in place: the sentence says what
 * will happen, and the same button, pressed again, does it. With `onResult`, the result goes
 * to the caller (for one status line shared by a table) instead of next to the button.
 */
export function ActionButton({
  action,
  children,
  className = 'btn btn-secondary',
  confirm,
  pendingLabel,
  disabled,
  ariaLabel,
  onResult,
}: {
  action: () => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  pendingLabel?: string;
  disabled?: boolean;
  /** A name for screen readers when the visible label is the same on every row, e.g. "Remove @sam". */
  ariaLabel?: string;
  onResult?: (state: ActionState) => void;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const [asking, setAsking] = useState(false);
  const confirmId = useId();
  const run = () => {
    setAsking(false);
    start(async () => {
      const result = await action();
      if (onResult) onResult(result);
      else setState(result);
    });
  };
  if (asking) {
    return (
      <span className="action confirm-inline" role="group" aria-labelledby={confirmId}>
        <span className="confirm-text" id={confirmId}>
          {confirm}
        </span>
        <span className="confirm-buttons">
          <button type="button" className={className} onClick={run} aria-label={ariaLabel} autoFocus>
            {children}
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </span>
      </span>
    );
  }
  return (
    <span className="action">
      <button type="button" className={className} disabled={disabled || pending} aria-label={ariaLabel} onClick={() => (confirm ? setAsking(true) : run())}>
        {pending && pendingLabel ? pendingLabel : children}
      </button>
      <FormStatus state={state} />
    </span>
  );
}

export function FormStatus({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <span className="form-status is-error" role="alert">
        {state.error}
      </span>
    );
  }
  if (state.message) {
    return (
      <span className="form-status" role="status">
        {state.message}
      </span>
    );
  }
  return null;
}
