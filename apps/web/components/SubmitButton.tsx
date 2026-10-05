'use client';

import { useFormStatus } from 'react-dom';

/** A submit button for a server-action form that disables itself and says what it's doing while the form posts. */
export function SubmitButton({ children, pendingLabel, className }: { children: React.ReactNode; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
