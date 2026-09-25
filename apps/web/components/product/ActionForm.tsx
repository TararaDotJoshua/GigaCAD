'use client';

import { useActionState } from 'react';
import type { ActionState } from '../../app/(product)/actions';
import { FormStatus } from './ActionButton';

/** A form posting to a server action, showing its error or confirmation under the button. */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  submitClassName = 'btn btn-primary',
  className = 'form',
  children,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel?: string;
  submitClassName?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      <div className="form-actions">
        <button type="submit" className={submitClassName} disabled={pending}>
          {pending && pendingLabel ? pendingLabel : submitLabel}
        </button>
        <FormStatus state={state} />
      </div>
    </form>
  );
}
