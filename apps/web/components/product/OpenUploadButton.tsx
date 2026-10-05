'use client';

import { PlusIcon } from '../icons';

/** The event the folder's Upload files button listens for, so other places on the page can open its picker. */
export const OPEN_UPLOAD_EVENT = 'gigacad:open-upload';

export function OpenUploadButton({ children = 'Upload files' }: { children?: React.ReactNode }) {
  return (
    <button type="button" className="btn btn-primary btn-small" onClick={() => window.dispatchEvent(new Event(OPEN_UPLOAD_EVENT))}>
      <PlusIcon className="icon" />
      {children}
    </button>
  );
}
