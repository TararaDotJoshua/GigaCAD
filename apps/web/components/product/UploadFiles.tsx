'use client';

import { useRef, useState, useTransition } from 'react';
import { addRootFile, replaceRootFile } from '../../app/(product)/actions';
import { uploadContents } from '../../lib/upload';
import { PlusIcon } from '../icons';

/**
 * Adds files to a root folder. A file named like one already there becomes that file's
 * next revision, after asking.
 */
export function UploadFiles({ projectId, parentId, existing }: { projectId: string; parentId: string | null; existing: Record<string, string> }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});

  function upload(files: File[]) {
    start(async () => {
      let added = 0;
      for (const [index, file] of files.entries()) {
        setStatus({ message: `Uploading ${file.name}${files.length > 1 ? ` (${index + 1} of ${files.length})` : ''}…` });
        const replacing = existing[file.name.toLowerCase()];
        if (replacing && !window.confirm(`${file.name} is already here. Save this as its next revision?`)) continue;
        const { sha256, error } = await uploadContents(projectId, file);
        if (!sha256) {
          setStatus({ error });
          return;
        }
        const result = replacing ? await replaceRootFile(projectId, replacing, sha256) : await addRootFile(projectId, parentId, file.name, sha256);
        if (result.error) {
          setStatus({ error: `${file.name}: ${result.error}` });
          return;
        }
        added++;
      }
      setStatus(added ? { message: `Uploaded ${added} ${added === 1 ? 'file' : 'files'}.` } : {});
    });
  }

  return (
    <span className="action">
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length) upload(files);
        }}
      />
      <button type="button" className="btn btn-primary btn-small" disabled={pending} onClick={() => input.current?.click()}>
        <PlusIcon className="icon" />
        {pending ? 'Uploading…' : 'Upload files'}
      </button>
      {status.error ? (
        <span className="form-status is-error" role="alert">
          {status.error}
        </span>
      ) : (
        status.message && (
          <span className="form-status" role="status">
            {status.message}
          </span>
        )
      )}
    </span>
  );
}

/** Uploads new contents for one root file, recorded as its next revision. */
export function ReplaceFile({ projectId, entryId, name }: { projectId: string; entryId: string; name: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  return (
    <span className="action">
      <input
        ref={input}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          start(async () => {
            setStatus({ message: `Uploading ${file.name}…` });
            const { sha256, error } = await uploadContents(projectId, file);
            setStatus(sha256 ? await replaceRootFile(projectId, entryId, sha256) : { error });
          });
        }}
      />
      <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => input.current?.click()} aria-label={`Replace ${name}`}>
        {pending ? 'Uploading…' : 'Replace…'}
      </button>
      {status.error ? (
        <span className="form-status is-error" role="alert">
          {status.error}
        </span>
      ) : (
        status.message && (
          <span className="form-status" role="status">
            {status.message}
          </span>
        )
      )}
    </span>
  );
}
