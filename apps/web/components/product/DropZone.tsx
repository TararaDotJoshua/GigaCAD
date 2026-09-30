'use client';

import { useState } from 'react';
import { DROP_FILES_EVENT } from './UploadFiles';

/** Makes the folder's file list accept dropped files, handing them to the folder's uploader. */
export function DropZone({ children }: { children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes('Files');
  return (
    <div
      className={over ? 'drop-zone is-over' : 'drop-zone'}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setOver(false);
        // Folders dropped from the desktop arrive as zero-byte entries with no type; skip them.
        const files = [...event.dataTransfer.files].filter((file) => file.size > 0 || file.type);
        if (files.length) window.dispatchEvent(new CustomEvent(DROP_FILES_EVENT, { detail: files }));
      }}
    >
      {children}
      {over && <div className="drop-zone-hint" aria-hidden="true">Drop files to upload them here</div>}
    </div>
  );
}
