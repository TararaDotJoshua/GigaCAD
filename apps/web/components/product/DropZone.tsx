'use client';

import { useEffect, useRef, useState } from 'react';
import { DROP_FILES_EVENT, type DroppedFiles } from './UploadFiles';

const hasFiles = (transfer: DataTransfer | null) => Boolean(transfer?.types.includes('Files'));

/** Splits a drop into files and folders. Folders from the desktop look like empty files, so ask the entry what it is. */
function readDrop(transfer: DataTransfer): DroppedFiles {
  const files: File[] = [];
  const folders: string[] = [];
  const items = [...transfer.items].filter((item) => item.kind === 'file');
  if (items.length > 0 && typeof items[0]!.webkitGetAsEntry === 'function') {
    for (const item of items) {
      const entry = item.webkitGetAsEntry();
      const file = item.getAsFile();
      if (entry?.isDirectory) folders.push(entry.name);
      else if (file) files.push(file);
    }
  } else {
    files.push(...transfer.files);
  }
  return { files, folders };
}

/**
 * Makes a writable folder accept dropped files, handing them to the folder's uploader. While it's
 * on the page, a file dropped anywhere else is ignored rather than opened by the browser, which
 * would leave GigaCAD.
 */
export function DropZone({ destination, children }: { destination: string; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const zone = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const guard = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (!(event.target instanceof Node && zone.current?.contains(event.target)) && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    document.addEventListener('dragover', guard);
    document.addEventListener('drop', guard);
    return () => {
      document.removeEventListener('dragover', guard);
      document.removeEventListener('drop', guard);
    };
  }, []);

  return (
    <div
      ref={zone}
      className={over ? 'drop-zone is-over' : 'drop-zone'}
      onDragOver={(event) => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        setOver(false);
        const dropped = readDrop(event.dataTransfer);
        if (dropped.files.length || dropped.folders.length) window.dispatchEvent(new CustomEvent<DroppedFiles>(DROP_FILES_EVENT, { detail: dropped }));
      }}
    >
      {children}
      {over && (
        <div className="drop-zone-hint" aria-hidden="true">
          <span className="drop-zone-pill">Drop to upload to {destination}</span>
        </div>
      )}
    </div>
  );
}
