'use client';

import { Fragment, startTransition, useActionState, useEffect, useRef, useState } from 'react';
import type { ActionState } from '../../app/(product)/actions';
import { pendingText } from '../../lib/pending';
import { safeAction } from '../../lib/safe-action';
import { FormStatus } from './ActionButton';

interface Result {
  readonly state: ActionState;
  /** Successful submits of a form that clears itself; its fields remount on each. */
  readonly cleared: number;
  /** The edit count the last successful submit saved, to tell whether the fields have changed since. */
  readonly saved: number;
}

/**
 * A form posting to a server action, showing its error or confirmation under the button.
 *
 * It submits from `onSubmit` rather than `<form action>`: React resets a form after every
 * action, failed ones included, which wiped what people typed and snapped selects back to
 * their defaults. Here fields keep their values; on an error the field the server named
 * gets focus. A form that adds things and stays on the page (a folder, a tag, a member)
 * passes `resetOnSuccess` to clear itself after each success.
 *
 * A form that edits saved values passes `discardable`: once its fields change, "Saved."
 * gives way to "Discard changes", and leaving the page asks first.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  submitClassName = 'btn btn-primary',
  className = 'form',
  resetOnSuccess = false,
  discardable = false,
  fieldsKey,
  children,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel?: string;
  submitClassName?: string;
  className?: string;
  resetOnSuccess?: boolean;
  discardable?: boolean;
  /** Fields whose defaults come from saved values pass those values here, so the fields remount when they change. */
  fieldsKey?: string;
  children: React.ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const submitted = useRef({ edits: 0, field: null as string | null });
  const [edits, setEdits] = useState(0);
  const [discards, setDiscards] = useState(0);
  const [{ state, cleared, saved }, dispatch, pending] = useActionState<Result, FormData>(
    async (previous, data) => {
      const state = await safeAction(() => action(previous.state, data));
      const ok = !state.error;
      return { state, cleared: previous.cleared + (ok && resetOnSuccess ? 1 : 0), saved: ok ? submitted.current.edits : previous.saved };
    },
    { state: {}, cleared: 0, saved: 0 },
  );
  const dirty = edits !== saved;

  // After an error, focus the field it's about. After a remount, focus goes back to the field it was in.
  useEffect(() => {
    const element = form.current;
    if (!element || pending) return;
    const name = state.error ? state.field : document.activeElement === document.body ? submitted.current.field : null;
    const target = name ? element.elements.namedItem(name) : null;
    const field = target instanceof RadioNodeList ? target[0] : target;
    if (!(field instanceof HTMLElement)) return;
    field.focus();
    if (state.error && field instanceof HTMLInputElement && /^(text|search|url|email)$/.test(field.type)) field.select();
  }, [state, pending, fieldsKey]);

  useEffect(() => {
    if (!discardable || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [discardable, dirty]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const active = document.activeElement;
    submitted.current = { edits, field: active instanceof HTMLElement && event.currentTarget.contains(active) ? active.getAttribute('name') : null };
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  return (
    <form ref={form} className={className} onSubmit={submit} onChange={() => setEdits((count) => count + 1)} aria-busy={pending || undefined}>
      <Fragment key={`${cleared}.${discards}.${fieldsKey ?? ''}`}>{children}</Fragment>
      <div className="form-actions">
        <button type="submit" className={submitClassName} aria-disabled={pending || undefined}>
          {pending ? (pendingLabel ?? pendingText(submitLabel)) : submitLabel}
        </button>
        {discardable && dirty && !pending && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setDiscards((count) => count + 1);
              setEdits(saved);
            }}
          >
            Discard changes
          </button>
        )}
        {/* "Saved." would be wrong once the fields change again. */}
        <FormStatus state={dirty && !state.error ? {} : state} />
      </div>
    </form>
  );
}
