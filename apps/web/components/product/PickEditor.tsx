'use client';

import type { ManifestEntry, PickRow, Picks } from '@gigacad/core';
import { useState, useTransition } from 'react';
import { savePicks } from '../../app/(product)/actions';
import { rowNote } from '../../lib/describe';
import { previewFormat } from '../../lib/preview';
import { canReplace, draftFromPicks, outcomeText, pickOutcome, picksFromDraft, samePicks, type RowPick } from '../../lib/picks';
import { FormStatus } from './ActionButton';
import { DownloadButton } from './DownloadButton';
import { FileGlyph } from './FileGlyph';
import { PreviewButton } from './PreviewButton';
import type { ActionState } from '../../app/(product)/actions';

/**
 * The diff pick: one row per changed file, each taking the branch's version or keeping
 * main's. A summary above says what the release will contain as picks change.
 * `nextNumber` is the release these picks would make; null once the request is finished.
 */
export function PickEditor({ projectId, requestId, rows, picks, mainFiles, latestNumber, nextNumber, readOnly }: { projectId: string; requestId: string; rows: PickRow[]; picks: Picks; mainFiles: ManifestEntry[]; latestNumber: number | null; nextNumber: number | null; readOnly: boolean }) {
  // `saved` is the server's picks this draft started from. Live refreshes can bring newer ones:
  // take them over an untouched draft, but never silently over unsaved changes.
  const incoming = draftFromPicks(rows, picks);
  const [saved, setSaved] = useState(incoming);
  const [draft, setDraft] = useState(incoming);
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const dirty = !samePicks(rows, saved, draft);
  const changedElsewhere = !samePicks(rows, saved, incoming);
  if (changedElsewhere && (!dirty || samePicks(rows, incoming, draft))) {
    setSaved(incoming);
    setDraft(incoming);
  }
  const reload = () => { setSaved(incoming); setDraft(incoming); setState({}); };
  const replacements = Object.values(draft).filter(pick => pick.kind === 'replace').map(pick => pick.mainItemId);
  const duplicate = replacements.length !== new Set(replacements).size;
  const set = (id: string, pick: RowPick) => { setDraft(current => ({ ...current, [id]: pick })); setState({}); };
  const outcome = outcomeText(pickOutcome(rows, draft));
  return <div>{rows.length > 0 && <p className="pick-summary" role="status">{nextNumber ? <>v{nextNumber} will change <strong>{outcome}</strong>{dirty ? ' (unsaved)' : ''}.</> : <>These picks changed <strong>{outcome}</strong>.</>}</p>}<div className="pick-list" role="group" aria-label="File picks">
    {rows.length === 0 && <p className="empty">There are no file differences to pick.</p>}
    {rows.map(row => { const pick = draft[row.itemId] ?? { kind: 'action' as const, action: row.defaultAction }; const note = rowNote(row, latestNumber); return <div className="pick-row" key={row.itemId}>
      <div className="file-cell"><FileGlyph path={row.path} /><div><span className="pick-name mono">{row.path}</span><span className={`pick-note${note.caution ? ' is-caution' : ''}`}>{note.text}</span></div>{row.branchChange && row.branchChange.kind !== 'deleted' && <span className="pick-files" aria-label={`Branch version of ${row.path}`}>{previewFormat(row.path) && <PreviewButton projectId={projectId} sha256={row.branchChange.after.blob} path={row.path} format={previewFormat(row.path)!} compare={mainCopy(mainFiles, row.itemId, row.branchChange.after.blob)} />}<DownloadButton projectId={projectId} sha256={row.branchChange.after.blob} path={row.path} /></span>}</div>
      {readOnly ? <span>{pick.kind === 'replace' ? `Replace ${mainFiles.find(file => file.itemId === pick.mainItemId)?.path ?? 'main item'}` : pick.action === 'take_branch' ? 'Take branch' : 'Keep main'}</span> : <div className="row-actions"><div className="segmented" aria-label={`Pick for ${row.path}`}>
        <button type="button" className={`segment${pick.kind === 'action' && pick.action === 'take_branch' ? ' is-selected' : ''}`} aria-pressed={pick.kind === 'action' && pick.action === 'take_branch'} onClick={() => set(row.itemId,{kind:'action',action:'take_branch'})}>{row.branchChange?.kind === 'added' ? 'Add as new' : row.branchChange?.kind === 'deleted' ? 'Remove' : 'Take branch'}</button>
        <button type="button" className={`segment${pick.kind === 'action' && pick.action === 'keep_main' ? ' is-selected' : ''}`} aria-pressed={pick.kind === 'action' && pick.action === 'keep_main'} onClick={() => set(row.itemId,{kind:'action',action:'keep_main'})}>Keep main</button>
      </div>{canReplace(row) && mainFiles.length > 0 && <select className="pick-replace" aria-label={`Replace main item with ${row.path}`} value={pick.kind === 'replace' ? pick.mainItemId : ''} onChange={event => set(row.itemId,event.target.value ? {kind:'replace',mainItemId:event.target.value} : {kind:'action',action:'take_branch'})}><option value="">Replace a main file…</option>{mainFiles.map(file => <option key={file.itemId} value={file.itemId}>{file.path}</option>)}</select>}</div>}
    </div>; })}
  </div>
    {!readOnly && changedElsewhere && dirty && <p className="notice notice-caution" role="status">Someone else saved different picks while you were editing. <button type="button" className="link-button" onClick={reload}>Load their picks</button> or save yours to replace them.</p>}
    {!readOnly && <div className="pick-actions">{dirty && <span className="badge badge-caution">Unsaved picks · candidate out of date</span>}{duplicate && <span className="form-status is-error">Two files cannot replace the same main item.</span>}<button className="btn btn-primary" type="button" disabled={!dirty || duplicate || pending} onClick={() => start(async () => setState(await savePicks(requestId,picksFromDraft(rows,draft))))}>Save picks</button><button className="btn btn-secondary" type="button" disabled={!dirty || pending} onClick={() => {setDraft(saved);setState({});}}>Discard</button><FormStatus state={state} /></div>}
  </div>;
}

/** Main's copy of a file, for a side-by-side preview, when it exists and differs from the branch's. */
function mainCopy(mainFiles: readonly ManifestEntry[], itemId: string, branchBlob: string) {
  const file = mainFiles.find((entry) => entry.itemId === itemId);
  return file && file.blob !== branchBlob ? { sha256: file.blob, path: file.path } : undefined;
}
