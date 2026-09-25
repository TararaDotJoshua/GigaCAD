'use client';

import type { ManifestEntry, PickRow, Picks } from '@gigacad/core';
import { useState, useTransition } from 'react';
import { savePicks } from '../../app/(product)/actions';
import { rowNote } from '../../lib/describe';
import { canReplace, draftFromPicks, picksFromDraft, samePicks, type RowPick } from '../../lib/picks';
import { FormStatus } from './ActionButton';
import type { ActionState } from '../../app/(product)/actions';

export function PickEditor({ requestId, rows, picks, mainFiles, latestNumber, readOnly }: { requestId: string; rows: PickRow[]; picks: Picks; mainFiles: ManifestEntry[]; latestNumber: number | null; readOnly: boolean }) {
  const saved = draftFromPicks(rows, picks);
  const [draft, setDraft] = useState(saved);
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const dirty = !samePicks(rows, saved, draft);
  const replacements = Object.values(draft).filter(pick => pick.kind === 'replace').map(pick => pick.mainItemId);
  const duplicate = replacements.length !== new Set(replacements).size;
  const set = (id: string, pick: RowPick) => { setDraft(current => ({ ...current, [id]: pick })); setState({}); };
  return <section className="stack"><div className="pick-list" role="group" aria-label="File picks">
    {rows.length === 0 && <p className="empty">There are no file differences to pick.</p>}
    {rows.map(row => { const pick = draft[row.itemId] ?? { kind: 'action' as const, action: row.defaultAction }; const note = rowNote(row, latestNumber); return <div className="pick-row" key={row.itemId}>
      <div><span className="pick-name mono">{row.path}</span><span className={`pick-note${note.caution ? ' is-caution' : ''}`}>{note.text}</span></div>
      {readOnly ? <span>{pick.kind === 'replace' ? `Replace ${mainFiles.find(file => file.itemId === pick.mainItemId)?.path ?? 'main item'}` : pick.action === 'take_branch' ? 'Take branch' : 'Keep main'}</span> : <div className="row-actions"><div className="segmented" aria-label={`Pick for ${row.path}`}>
        <button type="button" className={`segment${pick.kind === 'action' && pick.action === 'take_branch' ? ' is-selected' : ''}`} aria-pressed={pick.kind === 'action' && pick.action === 'take_branch'} onClick={() => set(row.itemId,{kind:'action',action:'take_branch'})}>{row.branchChange?.kind === 'added' ? 'Add as new' : row.branchChange?.kind === 'deleted' ? 'Remove' : 'Take branch'}</button>
        <button type="button" className={`segment${pick.kind === 'action' && pick.action === 'keep_main' ? ' is-selected' : ''}`} aria-pressed={pick.kind === 'action' && pick.action === 'keep_main'} onClick={() => set(row.itemId,{kind:'action',action:'keep_main'})}>Keep main</button>
      </div>{canReplace(row) && mainFiles.length > 0 && <select className="pick-replace" aria-label={`Replace main item with ${row.path}`} value={pick.kind === 'replace' ? pick.mainItemId : ''} onChange={event => set(row.itemId,event.target.value ? {kind:'replace',mainItemId:event.target.value} : {kind:'action',action:'take_branch'})}><option value="">Replace a main file…</option>{mainFiles.map(file => <option key={file.itemId} value={file.itemId}>{file.path}</option>)}</select>}</div>}
    </div>; })}
  </div>
    {!readOnly && <div className="row-actions">{dirty && <span className="badge badge-caution">Unsaved picks · candidate out of date</span>}{duplicate && <span className="form-status is-error">Two files cannot replace the same main item.</span>}<button className="btn btn-primary" type="button" disabled={!dirty || duplicate || pending} onClick={() => start(async () => setState(await savePicks(requestId,picksFromDraft(rows,draft))))}>Save picks</button><button className="btn btn-secondary" type="button" disabled={!dirty || pending} onClick={() => {setDraft(saved);setState({});}}>Discard</button><FormStatus state={state} /></div>}
  </section>;
}
