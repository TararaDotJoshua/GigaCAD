'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ActionState } from '../../app/(product)/actions';
import { ActionButton } from './ActionButton';

/**
 * What a release request page shares between its parts: whether the picks have unsaved
 * changes, which holds back approving and releasing until they're saved, and the latest
 * result of an action, which outlives the button that ran it.
 */
interface RequestDraft {
  readonly dirty: boolean;
  readonly setDirty: (dirty: boolean) => void;
  readonly notice: string | null;
  readonly setNotice: (notice: string | null) => void;
}

const Context = createContext<RequestDraft>({ dirty: false, setDirty: () => undefined, notice: null, setNotice: () => undefined });

export const useRequestDraft = () => useContext(Context);

const LEAVE = 'You have unsaved picks. Leave this page and lose them?';

export function RequestDraftProvider({ children }: { children: React.ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    // In-app links don't unload the page, so ask before following one. Runs before React's own handlers.
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      if (!window.confirm(LEAVE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('click', click, true);
    };
  }, [dirty]);
  const value = useMemo(() => ({ dirty, setDirty, notice, setNotice }), [dirty, notice]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * The "Next:" banner. Unsaved picks take it over, since nothing else can happen until
 * they're saved. `action` is a control that belongs with the sentence, like Build candidate.
 */
export function NextStep({ tone, children, action }: { tone: 'plain' | 'ready' | 'caution'; children: React.ReactNode; action?: React.ReactNode }) {
  const { dirty, notice } = useRequestDraft();
  if (dirty) {
    return (
      <div className="next-step is-waiting" role="status">
        <p>
          <strong>Next:</strong> You have unsaved picks. Save them to regenerate the candidate; nothing can be approved or released until then.
        </p>
      </div>
    );
  }
  return (
    <div className={`next-step${tone === 'ready' ? ' is-ready' : tone === 'caution' ? ' is-waiting' : ''}`} role="status">
      <p>
        {notice && <span className="next-step-notice">{notice} </span>}
        <strong>Next:</strong> {children}
      </p>
      {action}
    </div>
  );
}

/**
 * A request action whose result shows in the Next banner, since the button usually goes
 * away once it worked. Approving and building wait while picks are unsaved.
 */
export function RequestActionButton({
  action,
  children,
  className,
  confirm,
  pendingLabel,
  disabled,
}: {
  action: () => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  confirm?: string | undefined;
  pendingLabel?: string;
  disabled?: boolean;
}) {
  const { dirty, setNotice } = useRequestDraft();
  return (
    <>
      <ActionButton
        className={className}
        confirm={confirm}
        pendingLabel={pendingLabel}
        disabled={disabled || dirty}
        action={async () => {
          const result = await action();
          if (result.error) return result;
          setNotice(result.message ?? null);
          return {};
        }}
      >
        {children}
      </ActionButton>
      {dirty && <span className="form-hint">Save your picks first.</span>}
    </>
  );
}
