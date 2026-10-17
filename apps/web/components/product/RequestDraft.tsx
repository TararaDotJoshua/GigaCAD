'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ActionState } from '../../app/(product)/actions';
import { exportsMoved, reconcile, reviewChanged, settleOwnChange, type Review } from '../../lib/request-review';
import { safeAction } from '../../lib/safe-action';
import { ActionButton } from './ActionButton';

/**
 * What a release request page shares between its parts: whether the picks have unsaved
 * changes, which holds back approving and releasing until they're saved; the latest result of
 * an action, which outlives the button that ran it; and the candidate the viewer is reviewing.
 *
 * Live updates bring a regenerated or rebuilt candidate onto the page as soon as it exists.
 * Approving and releasing stay on the candidate the viewer was reviewing (`reviewedId`), so
 * the API refuses them as stale, and are held until the viewer says they've looked at the
 * new one. The candidate the viewer's own action built, like saving picks, needs no second
 * look; anything else, including what arrives after their action failed, does (see request-review).
 */
interface RequestDraft {
  readonly dirty: boolean;
  readonly setDirty: (dirty: boolean) => void;
  readonly notice: string | null;
  readonly setNotice: (notice: string | null) => void;
  readonly reviewedId: string | null;
  /** When an export of a candidate file last changed, as the viewer reviewed it (null: none). */
  readonly reviewedExports: string | null;
  /** The candidate on the page, or its exports, isn't what the viewer was reviewing. */
  readonly changed: boolean;
  /** Only an export changed, on the same candidate. */
  readonly exportChanged: boolean;
  readonly acknowledge: () => void;
  /** An action of this viewer's that changes the candidate is starting. */
  readonly expectOwnChange: () => void;
  /** It finished: the candidate it left (if it says) is the viewer's own. */
  readonly ownChangeDone: (result: ActionState) => void;
}

const Context = createContext<RequestDraft>({
  dirty: false,
  setDirty: () => undefined,
  notice: null,
  setNotice: () => undefined,
  reviewedId: null,
  reviewedExports: null,
  changed: false,
  exportChanged: false,
  acknowledge: () => undefined,
  expectOwnChange: () => undefined,
  ownChangeDone: () => undefined,
});

export const useRequestDraft = () => useContext(Context);

const LEAVE = 'You have unsaved picks. Leave this page and lose them?';

export function RequestDraftProvider({ candidateId, exportsChangedAt, children }: { candidateId: string | null; exportsChangedAt: string | null; children: React.ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const shown = useMemo(() => ({ candidateId, exportsChangedAt }), [candidateId, exportsChangedAt]);
  const [review, setReview] = useState<Review>({ reviewed: shown, own: null });
  // The candidate the viewer's own action built becomes the one under review once it's on the page.
  const reconciled = reconcile(review, shown);
  if (reconciled !== review) setReview(reconciled);
  const { candidateId: reviewedId, exportsChangedAt: reviewedExports } = review.reviewed;
  const changed = reviewChanged(review, shown);
  const exportChanged = changed && exportsMoved(review, shown);
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
  const value = useMemo(
    () => ({
      dirty,
      setDirty,
      notice,
      setNotice,
      reviewedId,
      reviewedExports,
      changed,
      exportChanged,
      acknowledge: () => {
        setReview({ reviewed: shown, own: null });
        setNotice(null);
      },
      expectOwnChange: () => setReview((current) => ({ ...current, own: 'running' })),
      ownChangeDone: (result: ActionState) => setReview((current) => ({ ...current, own: settleOwnChange(result) })),
    }),
    [dirty, notice, reviewedId, reviewedExports, changed, exportChanged, shown],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * The "Next:" banner. Unsaved picks take it over, since nothing else can happen until
 * they're saved. `action` is a control that belongs with the sentence, like Build candidate.
 */
export function NextStep({ tone, children, action, change }: { tone: 'plain' | 'ready' | 'caution'; children: React.ReactNode; action?: React.ReactNode; change?: string | null }) {
  const { dirty, notice, changed, exportChanged, acknowledge } = useRequestDraft();
  if (changed && !dirty) {
    return (
      <div className="next-step is-waiting" role="alert">
        <p>
          {exportChanged ? (
            <>
              <strong>An export changed.</strong> A STEP or STL of a file in the candidate was replaced while you were reviewing.{' '}
            </>
          ) : (
            <>
              <strong>The candidate changed.</strong> {change ? `${change} while you were reviewing. ` : ''}
            </>
          )}
          Review it again: approving and releasing wait until you have.
        </p>
        <button type="button" className="btn btn-secondary btn-small" onClick={acknowledge}>
          I’ve reviewed the new candidate
        </button>
      </div>
    );
  }
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
 * away once it worked. It waits while picks are unsaved. With `changesCandidate`, the
 * candidate it builds is the viewer's own doing, so it needs no second review.
 */
export function RequestActionButton({
  action,
  children,
  className,
  confirm,
  pendingLabel,
  disabled,
  changesCandidate,
}: {
  action: () => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  confirm?: string | undefined;
  pendingLabel?: string;
  disabled?: boolean;
  changesCandidate?: boolean;
}) {
  const { dirty, setNotice, expectOwnChange, ownChangeDone } = useRequestDraft();
  return (
    <>
      <ActionButton
        className={className}
        confirm={confirm}
        pendingLabel={pendingLabel}
        disabled={disabled || dirty}
        action={async () => {
          if (changesCandidate) expectOwnChange();
          const result = await safeAction(action);
          if (changesCandidate) ownChangeDone(result);
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

/**
 * Approves the candidate the viewer reviewed, which may not be the newest one on the page. If
 * the API says it's stale, the page reloads with the new candidate and asks for another look.
 */
export function ApproveButton({ action }: { action: (candidateManifestId: string, exportsChangedAt: string | null) => Promise<ActionState> }) {
  const { dirty, changed, reviewedId, reviewedExports, setNotice } = useRequestDraft();
  return (
    <>
      <ActionButton
        className="btn btn-primary"
        disabled={dirty || changed || !reviewedId}
        action={async () => {
          const result = await action(reviewedId!, reviewedExports);
          if (result.error) return result;
          setNotice(result.message ?? null);
          return {};
        }}
      >
        Approve candidate
      </ActionButton>
      {dirty ? <span className="form-hint">Save your picks first.</span> : changed ? <span className="form-hint">Review the new candidate first.</span> : null}
    </>
  );
}
