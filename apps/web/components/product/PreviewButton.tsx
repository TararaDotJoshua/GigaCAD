'use client';

import { useEffect, useRef, useState } from 'react';
import { downloadLink } from '../../app/(product)/actions';
import { MAX_PREVIEW_BYTES, formatBytesShort, type PreviewFormat } from '../../lib/preview';
import { CubeIcon } from '../icons';

/** One file to show: its contents' hash and its path. */
export interface PreviewFile {
  readonly sha256: string;
  readonly path: string;
}

/**
 * Opens a file in a 3D viewer. The viewer code and file load only when asked for.
 * With `compare`, the dialog shows that file (main's copy) and this one (the branch's) side by side.
 */
export function PreviewButton({ projectId, sha256, path, format, compare }: { projectId: string; sha256: string; path: string; format: PreviewFormat; compare?: PreviewFile }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const filename = path.split('/').pop() ?? path;
  const label = compare ? `Compare main and branch versions of ${filename}` : `Preview ${filename}`;

  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        title={label}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <CubeIcon className="icon" />
      </button>
      <dialog ref={dialog} className={compare ? 'model-dialog is-compare' : 'model-dialog'} onClose={() => setOpen(false)} aria-label={compare ? `3D previews of ${filename}, main and branch` : `3D preview of ${filename}`}>
        <div className="model-dialog-head">
          <span className="mono">{path}</span>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
        {compare ? (
          <div className="model-compare">
            <ModelPane projectId={projectId} file={compare} format={format} open={open} caption="Main" />
            <ModelPane projectId={projectId} file={{ sha256, path }} format={format} open={open} caption="Branch" />
          </div>
        ) : (
          <ModelPane projectId={projectId} file={{ sha256, path }} format={format} open={open} />
        )}
        <p className="model-hint">Drag to orbit, scroll to zoom, right-drag to pan.</p>
      </dialog>
    </>
  );
}

/** One model in the dialog, loaded while the dialog is open and released when it closes. */
function ModelPane({ projectId, file, format, open, caption }: { projectId: string; file: PreviewFile; format: PreviewFormat; open: boolean; caption?: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('');
  const { sha256 } = file;
  const filename = file.path.split('/').pop() ?? file.path;

  useEffect(() => {
    if (!open || !stage.current) return;
    const container = stage.current;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      setStatus(format === 'step' || format === 'iges' ? 'Loading the CAD reader…' : 'Loading…');
      const link = await downloadLink(projectId, sha256, filename);
      if (!link.url) throw new Error(link.error ?? 'The file couldn’t be loaded.');
      const response = await fetch(link.url, { signal: controller.signal });
      if (!response.ok) throw new Error('The file couldn’t be loaded.');
      const size = Number(response.headers.get('content-length') ?? 0);
      if (size > MAX_PREVIEW_BYTES) throw new Error(`This file is ${formatBytesShort(size)}, too large to preview. Download it instead.`);
      const bytes = await response.arrayBuffer();
      setStatus('Building the model…');
      const { showModel } = await import('../../lib/viewer');
      const release = await showModel(container, bytes, format);
      if (cancelled) release();
      else {
        dispose = release;
        setStatus('');
      }
    })().catch((error: unknown) => {
      if (!cancelled) setStatus(error instanceof Error ? error.message : 'The preview failed.');
    });
    return () => {
      cancelled = true;
      controller.abort();
      dispose?.();
    };
  }, [open, projectId, sha256, filename, format]);

  return (
    <div className="model-pane">
      {caption && <span className="model-caption">{caption}</span>}
      <div className="model-stage" ref={stage} />
      {status && <p className="model-status" role="status">{status}</p>}
    </div>
  );
}
