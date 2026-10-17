'use client';

import { useEffect, useState, useTransition } from 'react';
import type { ActionState } from '../../app/(product)/actions';
import { FormStatus } from './ActionButton';
import { useRequestDraft } from './RequestDraft';

/**
 * Releasing a request's candidate, asked in place first because it can't be undone. It
 * stays on the page while the candidate is current, so notes typed here survive a request
 * briefly becoming blocked; `blocked` says why the button is off. With `approve`, the
 * button approves the candidate too, for someone whose approval is the last one missing.
 * It releases the candidate the viewer reviewed: a new one arriving closes the confirm.
 */
export function ReleaseForm({
  action,
  releaseNumber,
  fileCount,
  approve,
  blocked,
  caution,
}: {
  action: (input: { candidateManifestId: string; exportsChangedAt: string | null; approve: boolean; notes: string }) => Promise<ActionState>;
  releaseNumber: number;
  fileCount: number;
  approve: boolean;
  blocked: string | null;
  caution: string | null;
}) {
  const { dirty, changed, reviewedId, reviewedExports } = useRequestDraft();
  const [notes, setNotes] = useState('');
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const version = `v${releaseNumber}`;
  const label = approve ? `Approve and release ${version}` : `Release ${version}`;
  const held = dirty ? 'Save your picks first.' : changed || !reviewedId ? 'The candidate changed. Review it again.' : blocked;
  const files = `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
  useEffect(() => {
    if (held) setAsking(false);
  }, [held]);
  // A confirm is for one candidate only.
  useEffect(() => setAsking(false), [reviewedId]);

  const submit = () => {
    setAsking(false);
    if (reviewedId) start(async () => setState(await action({ candidateManifestId: reviewedId, exportsChangedAt: reviewedExports, approve, notes })));
  };

  return (
    <div className="form release-form">
      <p className="muted">
        Releasing locks these {files} as {version}, permanently.
      </p>
      {caution && <p className="notice notice-caution">{caution}</p>}
      <label className="field">
        <span>
          Notes <em>optional</em>
        </span>
        <textarea name="notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <div className="form-actions">
        {asking ? (
          <span className="confirm-inline" role="group" aria-label={`Confirm ${label}`}>
            <span className="confirm-text">
              {approve ? `Approve this candidate and release it as ${version}?` : `Release ${version}?`} It permanently locks these {files}.{caution ? ` ${caution}` : ''}
            </span>
            <span className="confirm-buttons">
              <button type="button" className="btn btn-primary" onClick={submit} autoFocus>
                {label}
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </span>
          </span>
        ) : (
          <button type="button" className="btn btn-primary" disabled={pending || Boolean(held)} onClick={() => setAsking(true)}>
            {pending ? 'Releasing…' : label}
          </button>
        )}
        {held && !pending && <span className="form-hint">{held}</span>}
        <FormStatus state={state} />
      </div>
    </div>
  );
}
