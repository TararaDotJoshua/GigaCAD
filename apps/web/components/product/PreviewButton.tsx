'use client';

import { useEffect, useRef, useState } from 'react';
import { downloadLink } from '../../app/(product)/actions';
import { MAX_PREVIEW_BYTES, formatBytesShort, type PreviewFormat } from '../../lib/preview';
import type { ShownModel } from '../../lib/viewer';
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
  // Compared models are framed for the larger of the two, so a change in size shows.
  const [radii, setRadii] = useState<{ main?: number; branch?: number }>({});
  const shared = radii.main !== undefined && radii.branch !== undefined ? Math.max(radii.main, radii.branch) : undefined;
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
          setRadii({});
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
            <ModelPane projectId={projectId} file={compare} format={format} open={open} caption="Main" frameRadius={shared} onLoaded={(radius) => setRadii((current) => ({ ...current, main: radius }))} />
            <ModelPane projectId={projectId} file={{ sha256, path }} format={format} open={open} caption="Branch" frameRadius={shared} onLoaded={(radius) => setRadii((current) => ({ ...current, branch: radius }))} />
          </div>
        ) : (
          <ModelPane projectId={projectId} file={{ sha256, path }} format={format} open={open} />
        )}
        <p className="model-hint">Drag to orbit, scroll to zoom, right-drag to pan.{compare ? ' Both are shown at the same scale.' : ''}</p>
      </dialog>
    </>
  );
}

/** One model in the dialog, loaded while the dialog is open and released when it closes, with its size under it. */
function ModelPane({
  projectId,
  file,
  format,
  open,
  caption,
  frameRadius,
  onLoaded,
}: {
  projectId: string;
  file: PreviewFile;
  format: PreviewFormat;
  open: boolean;
  caption?: string;
  /** Frame for a model this big instead of this one's own size. */
  frameRadius?: number | undefined;
  onLoaded?: (radius: number) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('');
  const [size, setSize] = useState('');
  const shown = useRef<ShownModel | null>(null);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  useEffect(() => {
    if (frameRadius !== undefined) shown.current?.frame(frameRadius);
  }, [frameRadius]);
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
      const { showModel, sizeText } = await import('../../lib/viewer');
      const model = await showModel(container, bytes, format);
      if (cancelled) model.dispose();
      else {
        dispose = model.dispose;
        shown.current = model;
        setSize(sizeText(model.size, format));
        setStatus('');
        loaded.current?.(model.radius);
      }
    })().catch((error: unknown) => {
      if (!cancelled) setStatus(error instanceof Error ? error.message : 'The preview failed.');
    });
    return () => {
      cancelled = true;
      controller.abort();
      shown.current = null;
      setSize('');
      dispose?.();
    };
  }, [open, projectId, sha256, filename, format]);

  return (
    <div className="model-pane">
      {caption && <span className="model-caption">{caption}</span>}
      <div className="model-stage" ref={stage} />
      {status && <p className="model-status" role="status">{status}</p>}
      {size && <p className="model-size">{size}</p>}
    </div>
  );
}
