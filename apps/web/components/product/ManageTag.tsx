'use client';

import { useEffect, useState, useTransition } from 'react';
import { deleteTag, renameTag, type ActionState } from '../../app/(product)/actions';
import { ActionButton, FormStatus } from './ActionButton';

/** How long "Renamed." stays up. */
const NOTICE_MS = 3000;

/** One tag under Manage tags: its name to edit, and Rename and Delete, on one row of the rail. */
export function ManageTag({ projectId, tag }: { projectId: string; tag: { id: string; name: string; fileCount: number } }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!state.message) return;
    const timer = window.setTimeout(() => setState({}), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <div className="manage-tag">
      <form
        className="manage-tag-row"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          start(async () => setState(await renameTag(projectId, tag.id, {}, form)));
        }}
      >
        <label className="field">
          <span className="sr-only">Name for {tag.name}</span>
          <input name="name" required maxLength={50} defaultValue={tag.name} autoComplete="off" onChange={() => setState({})} />
        </label>
        <button type="submit" className="btn btn-secondary btn-small" disabled={pending}>
          {pending ? 'Renaming…' : 'Rename'}
        </button>
        <ActionButton
          action={deleteTag.bind(null, projectId, tag.id)}
          className="btn btn-danger btn-small"
          confirm={`Delete the tag ${tag.name}? It comes off ${tag.fileCount} ${tag.fileCount === 1 ? 'file' : 'files'}.`}
        >
          Delete
        </ActionButton>
      </form>
      <FormStatus state={state} />
    </div>
  );
}
