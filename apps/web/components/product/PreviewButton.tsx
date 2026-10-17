'use client';

import { formatBytes } from '@gigacad/core';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { downloadLink } from '../../app/(product)/actions';
import { PreviewError, confirmMessage, exportFilename, isFileProblem, previewGate, previewMessage, type PreviewFormat } from '../../lib/preview';
import type { ModelView } from '../../lib/viewer';
import { CubeIcon, PlusIcon } from '../icons';

/** One file to show: its contents' hash, its path and, when known, its size in bytes. */
export interface PreviewFile {
  readonly sha256: string;
  readonly path: string;
  readonly size?: number;
}

/** Which of a SolidWorks file's exports a preview shows. */
export type PreviewSource = 'stl' | 'step';

/** One model a pane can show, tried in order: the file (or export), then its fallback. */
interface Candidate {
  readonly sha256: string;
  readonly format: PreviewFormat;
  readonly size?: number;
  readonly source?: PreviewSource;
  /** The name a download of it is saved as. */
  readonly filename: string;
}

const LABEL: Record<PreviewSource, string> = { stl: 'STL', step: 'STEP' };
const basename = (path: string) => path.split('/').pop() ?? path;
const fromExport = (source: PreviewSource | undefined) => (source ? ` from its ${LABEL[source]} export` : '');

/**
 * Opens a file in a 3D viewer. The viewer code and file load only when asked for.
 *
 * - `projectId`, `sha256`, `path`, `format`: what to show. `path` names the file in the dialog;
 *   `sha256` and `format` are the bytes to read, which for a SolidWorks file are an export's.
 * - `compare`: main's copy of the file. The dialog then shows it and this one (the branch's) side by side.
 * - `size`: bytes of what will be shown, when known. Above MAX_PREVIEW_BYTES the dialog opens straight
 *   to "too large to preview" with a Download button and downloads nothing; above CONFIRM_PREVIEW_BYTES
 *   it asks first. Without it, the download's Content-Length is checked the same way before the body loads.
 * - `source`: set when `sha256` is a SolidWorks file's STL or STEP export. The dialog head and the
 *   button's label then say "<name> · from its STL export", and Download saves the export.
 * - `fallback`: another copy of the model (a SolidWorks file's STEP export), tried when the first
 *   can't be read or is too large. Its `size` is optional too. If both fail, the first one's error shows.
 *
 * Errors and the too-large state show a Download button for the file the pane was showing.
 */
export function PreviewButton({
  projectId,
  sha256,
  path,
  format,
  compare,
  size,
  source,
  fallback,
}: {
  projectId: string;
  sha256: string;
  path: string;
  format: PreviewFormat;
  compare?: PreviewFile;
  size?: number;
  source?: PreviewSource;
  fallback?: { readonly sha256: string; readonly format: PreviewFormat; readonly size?: number };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const views = useRef(new Map<string, ModelView>());
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(0);
  const [viewCount, setViewCount] = useState(0);
  const [shown, setShown] = useState(0);
  const [touch, setTouch] = useState(false);
  const filename = basename(path);
  const label = compare ? `Compare main and branch versions of ${filename}` : `Preview ${filename}${fromExport(source)}`;

  const primary: Candidate = { sha256, format, size, source, filename: source ? exportFilename(path, source) : filename };
  const fallbackSource = source && (fallback?.format === 'stl' || fallback?.format === 'step') ? fallback.format : source;
  const candidates: Candidate[] = fallback
    ? [primary, { ...fallback, source: fallbackSource, filename: fallbackSource ? exportFilename(path, fallbackSource) : filename }]
    : [primary];

  const register = useCallback((pane: string, view: ModelView | null) => {
    if (view) views.current.set(pane, view);
    else views.current.delete(pane);
    setViewCount(views.current.size);
  }, []);
  const each = (action: (view: ModelView) => void) => views.current.forEach(action);

  useEffect(() => {
    if (open) setTouch(window.matchMedia('(pointer: coarse)').matches);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        title={label}
        onClick={() => {
          dialog.current?.showModal();
          setShown(0);
          setOpened((count) => count + 1);
          setOpen(true);
        }}
      >
        <CubeIcon className="icon" />
      </button>
      <dialog
        ref={dialog}
        className={compare ? 'model-dialog is-compare' : 'model-dialog'}
        onClose={() => setOpen(false)}
        // A click that starts and ends on the dimmed backdrop closes the dialog; a drag out of the stage doesn't.
        onPointerDown={(event) => {
          pressedBackdrop.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && pressedBackdrop.current) dialog.current?.close();
        }}
        aria-label={compare ? `3D previews of ${filename}, main and branch` : `3D preview of ${filename}${fromExport(candidates[shown]?.source)}`}
      >
        <div className="model-dialog-head">
          <span className="model-title">
            <span className="mono">{path}</span>
            {!compare && candidates[shown]?.source && <span className="model-source"> · from its {LABEL[candidates[shown].source]} export</span>}
          </span>
          <span className="model-tools">
            <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in" disabled={viewCount === 0} onClick={() => each((view) => view.zoomIn())}>
              <PlusIcon className="icon" />
            </button>
            <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out" disabled={viewCount === 0} onClick={() => each((view) => view.zoomOut())}>
              <svg className="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true">
                <path d="M3 8h10" />
              </svg>
            </button>
            <button type="button" className="icon-button" aria-label="Reset view" title="Reset view" disabled={viewCount === 0} onClick={() => each((view) => view.reset())}>
              <svg className="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />
              </svg>
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => dialog.current?.close()}>
              Close
            </button>
          </span>
        </div>
        {compare ? (
          <div className="model-compare">
            <ModelPane
              key={`main-${opened}`}
              name="main"
              projectId={projectId}
              candidates={[{ sha256: compare.sha256, format, size: compare.size, filename: basename(compare.path) }]}
              open={open}
              caption="Main"
              onView={register}
            />
            <ModelPane key={`branch-${opened}`} name="branch" projectId={projectId} candidates={candidates} open={open} caption="Branch" onView={register} />
          </div>
        ) : (
          <ModelPane key={opened} name="file" projectId={projectId} candidates={candidates} open={open} onView={register} onShown={setShown} />
        )}
        <p className={viewCount > 0 ? 'model-hint' : 'model-hint is-hidden'} aria-hidden={viewCount === 0}>
          {touch ? 'Drag to orbit, pinch to zoom, two-finger drag to pan.' : 'Drag to orbit, scroll to zoom, right-drag to pan.'}
        </p>
      </dialog>
    </>
  );
}

type PaneState =
  | { phase: 'loading'; status: string }
  | { phase: 'confirm'; size: number }
  | { phase: 'error'; message: string; download: Candidate }
  | { phase: 'ready' };

/** The pane's place in its list of candidates; `firstError` is kept to show if the fallback fails too. */
interface Attempt {
  index: number;
  confirmed: boolean;
  firstError?: { message: string; download: Candidate };
}

/** One model in the dialog, loaded while the dialog is open and released when it closes. */
function ModelPane({
  name,
  projectId,
  candidates,
  open,
  caption,
  onView,
  onShown,
}: {
  name: string;
  projectId: string;
  candidates: readonly Candidate[];
  open: boolean;
  caption?: string;
  onView: (pane: string, view: ModelView | null) => void;
  onShown?: (index: number) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PaneState>({ phase: 'loading', status: '' });
  const [attempt, setAttempt] = useState<Attempt>({ index: 0, confirmed: false });
  const [size, setSize] = useState<number | undefined>();
  const candidate = candidates[attempt.index] ?? candidates[0]!;
  const { sha256, format, source } = candidate;
  const knownSize = candidate.size;
  const last = attempt.index >= candidates.length - 1;
  const filename = candidate.filename;

  useEffect(() => {
    if (!open || !stage.current) return;
    const container = stage.current;
    const controller = new AbortController();
    const { signal } = controller;
    let view: ModelView | undefined;
    let cancelled = false;
    const confirmed = attempt.confirmed;

    /** Shows this failure, or moves on to the next candidate when the file itself was the problem. */
    const fail = (error: unknown) => {
      const message = previewMessage(error, format, Boolean(source));
      if (!last && isFileProblem(error)) {
        setAttempt({ index: attempt.index + 1, confirmed: false, firstError: attempt.firstError ?? { message, download: candidate } });
        onShown?.(attempt.index + 1);
        return;
      }
      if (attempt.firstError) onShown?.(0);
      setState({ phase: 'error', ...(attempt.firstError ?? { message, download: candidate }) });
    };
    /** Too large, or large enough to ask first. Returns whether to stop here. */
    const gate = (bytes: number | undefined) => {
      setSize(bytes);
      const verdict = previewGate(bytes, confirmed);
      if (verdict === 'too-large') fail(new PreviewError('too-large', { size: bytes }));
      else if (verdict === 'confirm') setState({ phase: 'confirm', size: bytes! });
      return verdict !== 'ok';
    };

    if (gate(knownSize)) return;
    (async () => {
      setState({ phase: 'loading', status: knownSize === undefined ? 'Downloading…' : `Downloading ${formatBytes(knownSize)}…` });
      // Server actions run one at a time and can't be called off, so a run cancelled at once
      // (Strict Mode's second mount, a quick close) doesn't queue one.
      await Promise.resolve();
      if (cancelled) return;
      const link = await downloadLink(projectId, sha256, filename);
      if (cancelled) return;
      if (!link.url) throw new PreviewError('download', { message: link.error });
      const response = await fetch(link.url, { signal });
      if (!response.ok) throw new PreviewError('download');
      const length = Number(response.headers.get('content-length') ?? '');
      // Stop the download before its body arrives when it turns out too large, or large enough to ask.
      if (knownSize === undefined && gate(length > 0 ? length : undefined)) {
        controller.abort();
        return;
      }
      const bytes = await response.arrayBuffer();
      if (cancelled) return;
      const { showModel } = await import('../../lib/viewer');
      if (cancelled) return;
      view = await showModel(container, bytes, format, {
        signal,
        onStatus: (status) => setState({ phase: 'loading', status }),
      });
      if (cancelled) {
        view.release();
        view = undefined;
        return;
      }
      onView(name, view);
      setState({ phase: 'ready' });
    })().catch((error: unknown) => {
      if (!cancelled) fail(error);
    });
    return () => {
      cancelled = true;
      controller.abort();
      if (view) {
        onView(name, null);
        view.release();
      }
    };
    // `candidate` follows from `attempt`; its fields are listed so a new candidates array doesn't restart the load.
  }, [open, attempt, projectId, sha256, format, source, knownSize, filename, last, name, onView, onShown]);

  const sizeText = size === undefined ? '' : `, ${formatBytes(size)}`;
  return (
    <div className="model-pane">
      {caption && <span className="model-caption">{caption}</span>}
      <div
        className="model-stage"
        ref={stage}
        tabIndex={state.phase === 'ready' ? 0 : -1}
        role="img"
        aria-label={`${filename}${sizeText}, 3D preview. Arrow keys pan, Shift and arrow keys orbit, plus and minus zoom, 0 resets the view.`}
      />
      {state.phase === 'loading' && state.status && (
        <p className="model-status" role="status">
          {state.status}
        </p>
      )}
      {state.phase === 'confirm' && (
        <div className="model-status" role="status">
          <p>{confirmMessage(state.size, format, Boolean(source))}</p>
          <div className="model-status-actions">
            <button type="button" className="btn btn-primary btn-small" onClick={() => setAttempt({ ...attempt, confirmed: true })}>
              Preview
            </button>
            <PaneDownload projectId={projectId} file={candidate} />
          </div>
        </div>
      )}
      {state.phase === 'error' && (
        <div className="model-status is-error" role="alert">
          <p>{state.message}</p>
          <div className="model-status-actions">
            <PaneDownload projectId={projectId} file={state.download} />
          </div>
        </div>
      )}
    </div>
  );
}

/** A plain Download button for when the preview can't show the file. */
function PaneDownload({ projectId, file }: { projectId: string; file: Candidate }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-small"
        disabled={pending}
        aria-label={`Download ${file.filename}`}
        onClick={() =>
          start(async () => {
            const result = await downloadLink(projectId, file.sha256, file.filename);
            setError('');
            if (result.url) window.location.assign(result.url);
            else setError(result.error ?? 'Download failed. Try again.');
          })
        }
      >
        Download
      </button>
      {error && <span className="form-status is-error">{error}</span>}
    </>
  );
}
