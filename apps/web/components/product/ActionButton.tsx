'use client';

import { useId, useLayoutEffect, useRef, useState, useTransition } from 'react';
import type { ActionState } from '../../app/(product)/actions';
import { keepFocusNear } from '../../lib/focus';
import { pendingText } from '../../lib/pending';
import { safeAction } from '../../lib/safe-action';
import { useDismiss } from '../../lib/use-dismiss';
import { announce } from './Announcer';

/**
 * A button that runs one server action (already bound to its arguments), with the result
 * shown next to it. With `confirm`, the first click asks in place: the sentence says what
 * will happen, focus moves to Cancel (so a second Enter can't do it by accident), and the
 * same button, pressed again, does it. Escape or a click elsewhere cancels.
 *
 * Success messages go to the page's status region, because a refresh often removes the
 * row the button sat in. If it does, focus moves to the nearest heading instead of the page.
 * With `onResult`, the result goes to the caller (for one status line shared by a table) instead.
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
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const [asking, setAsking] = useState(false);
  const confirmId = useId();
  // Where focus goes when the confirm row closes: back to the button, unless nothing asked.
  const refocus = useRef(false);

  useLayoutEffect(() => {
    if (asking) cancel.current?.focus();
    else if (refocus.current) button.current?.focus();
    refocus.current = false;
  }, [asking]);

  useLayoutEffect(() => {
    const element = root.current;
    return () => {
      if (element?.contains(document.activeElement)) keepFocusNear(element);
    };
  }, []);

  const close = (refocusButton = true) => {
    refocus.current = refocusButton;
    setAsking(false);
  };
  useDismiss(asking, root, (how) => close(how === 'escape'));
  const run = () => {
    if (pending) return;
    if (asking) close();
    start(async () => {
      const result = await safeAction(action);
      if (onResult) return onResult(result);
      // Errors stay beside the button; successes are announced where they outlive it.
      setState(result.error || !result.message || !announce(result.message) ? result : {});
    });
  };
  const label = pending ? (pendingLabel ?? pendingText(children)) : children;

  return (
    <span ref={root} className={asking ? 'action confirm-inline' : 'action'} role={asking ? 'group' : undefined} aria-labelledby={asking ? confirmId : undefined}>
      {asking ? (
        <>
          <span className="confirm-text" id={confirmId}>
            {confirm}
          </span>
          <span className="confirm-buttons">
            <button type="button" className={className} onClick={run} aria-label={ariaLabel}>
              {children}
            </button>
            <button ref={cancel} type="button" className="btn btn-secondary btn-small" onClick={() => close()}>
              Cancel
            </button>
          </span>
        </>
      ) : (
        <>
          <button
            ref={button}
            type="button"
            className={className}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
            onClick={() => (pending ? undefined : confirm ? setAsking(true) : run())}
          >
            {label}
          </button>
          <FormStatus state={state} />
        </>
      )}
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
