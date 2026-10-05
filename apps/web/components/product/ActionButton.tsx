'use client';

import { useState, useTransition } from 'react';
import type { ActionState } from '../../app/(product)/actions';

/**
 * A button that runs one server action (already bound to its arguments), with the result
 * shown next to it. With `confirm`, the first click asks in place: the sentence says what
 * will happen, and the same button, pressed again, does it.
 */
export function ActionButton({
  action,
  children,
  className = 'btn btn-secondary',
  confirm,
  pendingLabel,
  disabled,
}: {
  action: () => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  pendingLabel?: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const [asking, setAsking] = useState(false);
  const run = () => {
    setAsking(false);
    start(async () => setState(await action()));
  };
  if (asking) {
    return (
      <span className="action confirm-inline" role="group">
        <span className="confirm-text">{confirm}</span>
        <span className="confirm-buttons">
          <button type="button" className={className} onClick={run} autoFocus>
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
      <button type="button" className={className} disabled={disabled || pending} onClick={() => (confirm ? setAsking(true) : run())}>
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
