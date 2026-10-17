'use client';

import type { ManifestEntry, PickRow, Picks } from '@gigacad/core';
import { useEffect, useState, useTransition } from 'react';
import { savePicks } from '../../app/(product)/actions';
import { safeAction } from '../../lib/safe-action';
import { rowNote } from '../../lib/describe';
import { previewFormat } from '../../lib/preview';
import { canReplace, draftFromPicks, hasStrayPicks, outcomeText, pickChoices, pickLabel, pickOutcome, picksFromDraft, replaceableFiles, replacedBy, samePicks, type RowPick } from '../../lib/picks';
import { FormStatus } from './ActionButton';
import { DownloadButton } from './DownloadButton';
import { FileGlyph } from './FileGlyph';
import { PreviewButton } from './PreviewButton';
import { useRequestDraft } from './RequestDraft';
import type { ActionState } from '../../app/(product)/actions';

/**
 * The diff pick: one row per changed file, each taking the branch's version or keeping
 * main's. A summary above says what the release will contain as picks change.
 * `nextNumber` is the release these picks would make; null once the request is finished.
 */
export function PickEditor({
  projectId,
  requestId,
  rows,
  picks,
  mainFiles,
  baseNumber,
  latestNumber,
  nextNumber,
  finished,
  readOnly,
  picksOk,
  hasCandidate,
  resetWarning,
  rebuiltElsewhere,
  releasedBlobs,
}: {
  projectId: string;
  requestId: string;
  rows: PickRow[];
  picks: Picks;
  mainFiles: ManifestEntry[];
  /** The release the branch started from. */
  baseNumber: number | null;
  latestNumber: number | null;
  nextNumber: number | null;
  finished: 'released' | 'closed' | null;
  readOnly: boolean;
  /** False when the saved picks have errors; offers a reset to the defaults. */
  picksOk: boolean;
  hasCandidate: boolean;
  /** What saving throws away, like "1 approval (@bea)", to confirm first; null when nothing. */
  resetWarning: string | null;
  /** Files a SolidWorks rebuild changed that no pick row covers. */
  rebuiltElsewhere: number;
  /** For a released request: the released contents by item, which a rebuild may have changed. */
  releasedBlobs?: Readonly<Record<string, string>>;
}) {
  // `saved` is the server's picks this draft started from. Live refreshes can bring newer ones:
  // take them over an untouched draft, but never silently over unsaved changes.
  const incoming = draftFromPicks(rows, picks);
  const [saved, setSaved] = useState(incoming);
  const [draft, setDraft] = useState(incoming);
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const [asking, setAsking] = useState(false);
  const { setDirty, expectOwnChange, ownChangeDone } = useRequestDraft();
  const dirty = !samePicks(rows, saved, draft);
  const changedElsewhere = !samePicks(rows, saved, incoming);
  if (changedElsewhere && (!dirty || samePicks(rows, incoming, draft))) {
    setSaved(incoming);
    setDraft(incoming);
  }
  useEffect(() => setDirty(!readOnly && dirty), [readOnly, dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);
  // Saved picks the table can't show, like an action for a file that isn't a row, are cleared by saving.
  const stray = !readOnly && hasStrayPicks(rows, picks);
  const reload = () => {
    setSaved(incoming);
    setDraft(incoming);
    setState({});
  };
  const replaced = replacedBy(rows, draft);
  const duplicate = replaced.size !== Object.values(draft).filter((pick) => pick.kind === 'replace').length;
  const set = (id: string, pick: RowPick) => {
    setDraft((current) => ({ ...current, [id]: pick }));
    setState({});
    setAsking(false);
  };
  const numbers = { base: baseNumber, latest: latestNumber };
  const pathOf = (itemId: string) => mainFiles.find((file) => file.itemId === itemId)?.path ?? rows.find((row) => row.itemId === itemId)?.path;
  const replaceOptions = replaceableFiles(mainFiles, rows);
  const outcome = outcomeText(pickOutcome(rows, draft));
  const rebuilt = rebuiltElsewhere ? `, plus ${rebuiltElsewhere} ${rebuiltElsewhere === 1 ? 'file' : 'files'} rebuilt in SolidWorks` : '';
  const save = () => {
    setAsking(false);
    expectOwnChange();
    // A failed request keeps the draft and says so, instead of replacing the page with the error screen.
    start(async () => {
      const result = await safeAction(() => savePicks(requestId, picksFromDraft(rows, draft)));
      ownChangeDone(result);
      setState(result);
    });
  };

  return (
    <div>
      {rows.length > 0 && (
        <p className="pick-summary" role="status">
          {nextNumber ? (
            <>
              v{nextNumber} will change <strong>{outcome}</strong>
              {rebuilt}
              {dirty ? ' (unsaved)' : ''}.
            </>
          ) : finished === 'closed' ? (
            <>
              These picks would have changed <strong>{outcome}</strong>
              {rebuilt}.
            </>
          ) : (
            <>
              These picks changed <strong>{outcome}</strong>
              {rebuilt}.
            </>
          )}
        </p>
      )}
      <div className="pick-list" role="group" aria-label="File picks">
        {rows.length === 0 && <p className="empty">There are no file differences to pick.</p>}
        {rows.map((row) => {
          const pick = draft[row.itemId] ?? { kind: 'action' as const, action: row.defaultAction };
          const note = rowNote(row, latestNumber);
          const choices = pickChoices(row, numbers);
          const replacement = replaced.get(row.itemId);
          const taking = pick.kind === 'action' && pick.action === 'take_branch';
          // Taking the branch over a main change undoes that change; say so before it's saved.
          const overwrites = !replacement && taking && row.mainChange && (!row.branchChange || row.conflict) ? `${row.branchChange ? 'Overwrites' : 'Undoes'} main’s change${latestNumber ? ` in v${latestNumber}` : ''}` : null;
          const branchBlob = row.branchChange && row.branchChange.kind !== 'deleted' ? row.branchChange.after.blob : null;
          const shownBlob = branchBlob && taking && releasedBlobs?.[row.itemId] ? releasedBlobs[row.itemId]! : branchBlob;
          return (
            <div className="pick-row" key={row.itemId}>
              <div className="file-cell">
                <FileGlyph path={row.path} />
                <div>
                  <span className="pick-name mono">{row.path}</span>
                  <span className={`pick-note${note.caution ? ' is-caution' : ''}`}>{note.text}</span>
                  {overwrites && <span className="pick-note is-caution">{overwrites}</span>}
                </div>
                {shownBlob && (
                  <span className="pick-files" aria-label={`${shownBlob === branchBlob ? 'Branch' : 'Released'} version of ${row.path}`}>
                    {previewFormat(row.path) && <PreviewButton projectId={projectId} sha256={shownBlob} path={row.path} format={previewFormat(row.path)!} compare={mainCopy(mainFiles, row.itemId, shownBlob)} />}
                    <DownloadButton projectId={projectId} sha256={shownBlob} path={row.path} />
                  </span>
                )}
              </div>
              {replacement ? (
                <span className="pick-state">Replaced by {replacement}</span>
              ) : readOnly ? (
                <span className="pick-state">{pickLabel(row, pick, numbers, pathOf)}</span>
              ) : (
                <div className="row-actions">
                  <div className="segmented" role="group" aria-label={`Pick for ${row.path}`}>
                    <button type="button" className={`segment${taking ? ' is-selected' : ''}`} aria-pressed={taking} onClick={() => set(row.itemId, { kind: 'action', action: 'take_branch' })}>
                      {choices.take}
                    </button>
                    <button
                      type="button"
                      className={`segment${pick.kind === 'action' && pick.action === 'keep_main' ? ' is-selected' : ''}`}
                      aria-pressed={pick.kind === 'action' && pick.action === 'keep_main'}
                      onClick={() => set(row.itemId, { kind: 'action', action: 'keep_main' })}
                    >
                      {choices.keep}
                    </button>
                  </div>
                  {canReplace(row) && replaceOptions.length > 0 && (
                    <select
                      className="pick-replace"
                      aria-label={`Replace main item with ${row.path}`}
                      value={pick.kind === 'replace' ? pick.mainItemId : ''}
                      onChange={(event) => set(row.itemId, event.target.value ? { kind: 'replace', mainItemId: event.target.value } : { kind: 'action', action: 'take_branch' })}
                    >
                      <option value="">Replace a main file…</option>
                      {replaceOptions.map((file) => (
                        <option key={file.itemId} value={file.itemId}>
                          {file.path}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!readOnly && changedElsewhere && dirty && (
        <p className="notice notice-caution" role="status">
          Someone else saved different picks while you were editing.{' '}
          <button type="button" className="link-button" onClick={reload}>
            Load their picks
          </button>{' '}
          or save yours to replace them.
        </p>
      )}
      {!readOnly && (
        <div className="pick-actions">
          {dirty && <span className="badge badge-caution">{hasCandidate ? 'Unsaved picks · candidate out of date' : 'Unsaved picks · save to build the candidate'}</span>}
          {duplicate && <span className="form-status is-error">Two files cannot replace the same main item.</span>}
          {asking ? (
            <span className="confirm-inline" role="group" aria-label="Confirm saving picks">
              <span className="confirm-text">Saving regenerates the candidate and resets {resetWarning}.</span>
              <span className="confirm-buttons">
                <button type="button" className="btn btn-primary" onClick={save} autoFocus>
                  Save picks
                </button>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setAsking(false)}>
                  Cancel
                </button>
              </span>
            </span>
          ) : (
            <button className="btn btn-primary" type="button" disabled={!(dirty || stray) || duplicate || pending} onClick={() => (resetWarning ? setAsking(true) : save())}>
              {pending ? 'Saving…' : 'Save picks'}
            </button>
          )}
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!dirty || pending}
            onClick={() => {
              setDraft(saved);
              setState({});
              setAsking(false);
            }}
          >
            Discard
          </button>
          {!picksOk && (
            <button
              className="btn btn-secondary"
              type="button"
              disabled={pending}
              onClick={() => {
                setDraft(draftFromPicks(rows, {}));
                setState({});
              }}
            >
              Reset picks to defaults
            </button>
          )}
          <FormStatus state={state} />
        </div>
      )}
    </div>
  );
}

/** Main's copy of a file, for a side-by-side preview, when it exists and differs from the branch's. */
function mainCopy(mainFiles: readonly ManifestEntry[], itemId: string, branchBlob: string) {
  const file = mainFiles.find((entry) => entry.itemId === itemId);
  return file && file.blob !== branchBlob ? { sha256: file.blob, path: file.path } : undefined;
}
