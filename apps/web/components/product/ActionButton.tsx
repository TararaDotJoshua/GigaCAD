'use client';

import { useState, useTransition } from 'react';
import type { ActionState } from '../../app/(product)/actions';

/**
 * A button that runs one server action (already bound to its arguments), with an
 * optional confirmation and the result shown next to it.
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
  return (
    <span className="action">
      <button
        type="button"
        className={className}
        disabled={disabled || pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setState(await action()));
        }}
      >
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
