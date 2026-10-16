'use client';

import { useRef, useState } from 'react';
import { createFolder } from '../../app/(product)/actions';
import { useDismissDetails } from '../../lib/use-dismiss';
import { FolderIcon } from '../icons';
import { ActionForm } from './ActionForm';

/** "New folder" as a popover: the name field takes focus, Escape or a click elsewhere closes it. */
export function NewFolderMenu({ projectId, folderId }: { projectId: string; folderId: string | null }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useDismissDetails(open, menu);
  return (
    <details
      ref={menu}
      className="menu"
      onToggle={(event) => {
        const opened = event.currentTarget.open;
        setOpen(opened);
        if (opened) event.currentTarget.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
      }}
    >
      <summary className="btn btn-secondary btn-small">
        <FolderIcon className="icon" />
        New folder
      </summary>
      <div className="menu-list menu-form">
        <ActionForm action={createFolder.bind(null, projectId, folderId)} submitLabel="Create folder" submitClassName="btn btn-primary btn-small" resetOnSuccess>
          <label className="field">
            <span>Folder name</span>
            <input name="name" required maxLength={255} autoComplete="off" />
          </label>
        </ActionForm>
      </div>
    </details>
  );
}
