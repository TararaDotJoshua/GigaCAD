'use client';

import { useEffect, useRef, useState } from 'react';
import { downloadLink } from '../../app/(product)/actions';
import { MAX_PREVIEW_BYTES, formatBytesShort, type PreviewFormat } from '../../lib/preview';
import { CubeIcon } from '../icons';

/** Opens a file in a 3D viewer. The viewer code and file load only when asked for. */
export function PreviewButton({ projectId, sha256, path, format }: { projectId: string; sha256: string; path: string; format: PreviewFormat }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const filename = path.split('/').pop() ?? path;

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
    <>
      <button
        type="button"
        className="icon-button"
        aria-label={`Preview ${filename}`}
        title={`Preview ${filename}`}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <CubeIcon className="icon" />
      </button>
      <dialog ref={dialog} className="model-dialog" onClose={() => setOpen(false)} aria-label={`3D preview of ${filename}`}>
        <div className="model-dialog-head">
          <span className="mono">{path}</span>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
        <div className="model-stage" ref={stage} />
        {status && <p className="model-status" role="status">{status}</p>}
        <p className="model-hint">Drag to orbit, scroll to zoom, right-drag to pan.</p>
      </dialog>
    </>
  );
}
