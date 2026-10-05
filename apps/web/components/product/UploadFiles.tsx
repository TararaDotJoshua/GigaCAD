'use client';

import { formatBytes } from '@gigacad/core';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { addRootFile, replaceRootFile, type ActionState } from '../../app/(product)/actions';
import { uploadContents, type UploadPhase } from '../../lib/upload';
import { PlusIcon } from '../icons';
import { OPEN_UPLOAD_EVENT } from './OpenUploadButton';

/** Files dropped anywhere on the folder's drop zone arrive as this event. */
export const DROP_FILES_EVENT = 'gigacad:drop-files';

interface Item {
  readonly name: string;
  readonly phase: UploadPhase | 'waiting' | 'done' | 'failed' | 'skipped';
  readonly progress: number;
  readonly error?: string;
}

/** Who pays for the project's storage, to word a storage-full refusal. */
export interface StorageOwner {
  readonly handle: string;
  readonly isYou: boolean;
}

/**
 * Adds files to a root folder, one after another, with progress for each. Files named
 * like one already here become that file's next revision, after asking once for the batch.
 * A failed file doesn't stop the rest, except a full storage quota, which stops them all.
 */
export function UploadFiles({ projectId, parentId, existing, owner }: { projectId: string; parentId: string | null; existing: Record<string, string>; owner: StorageOwner }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [items, setItems] = useState<Item[]>([]);
  const [collisions, setCollisions] = useState<File[] | null>(null);
  const [queued, setQueued] = useState<File[]>([]);
  const [full, setFull] = useState<ActionState['storageFull']>();

  useEffect(() => {
    const open = () => input.current?.click();
    const drop = (event: Event) => begin((event as CustomEvent<File[]>).detail);
    window.addEventListener(OPEN_UPLOAD_EVENT, open);
    window.addEventListener(DROP_FILES_EVENT, drop);
    return () => {
      window.removeEventListener(OPEN_UPLOAD_EVENT, open);
      window.removeEventListener(DROP_FILES_EVENT, drop);
    };
  });

  function begin(files: File[]) {
    if (!files.length || pending) return;
    const taken = files.filter((file) => existing[file.name.toLowerCase()]);
    if (taken.length) {
      setQueued(files);
      setCollisions(taken);
    } else upload(files, true);
  }

  function upload(files: File[], replace: boolean) {
    setCollisions(null);
    setFull(undefined);
    const batch = replace ? files : files.filter((file) => !existing[file.name.toLowerCase()]);
    const skipped = files.filter((file) => !batch.includes(file));
    setItems([...batch.map((file) => ({ name: file.name, phase: 'waiting' as const, progress: 0 })), ...skipped.map((file) => ({ name: file.name, phase: 'skipped' as const, progress: 0 }))]);
    const update = (index: number, change: Partial<Item>) => setItems((current) => current.map((item, i) => (i === index ? { ...item, ...change } : item)));
    start(async () => {
      for (const [index, file] of batch.entries()) {
        const replacing = existing[file.name.toLowerCase()];
        const uploaded = await uploadContents(projectId, file, (phase, progress) => update(index, { phase, progress }));
        const result = uploaded.sha256
          ? replacing
            ? await replaceRootFile(projectId, replacing, uploaded.sha256)
            : await addRootFile(projectId, parentId, file.name, uploaded.sha256)
          : uploaded;
        if (result.storageFull) {
          // Every other file would be refused too.
          setFull(result.storageFull);
          setItems((current) => current.map((item, i) => (i === index ? { ...item, phase: 'failed', error: 'Out of storage' } : i > index && item.phase === 'waiting' ? { ...item, phase: 'skipped' } : item)));
          return;
        }
        update(index, result.error ? { phase: 'failed', error: result.error } : { phase: 'done', progress: 1 });
      }
    });
  }

  const done = items.filter((item) => item.phase === 'done').length;
  const failed = items.filter((item) => item.phase === 'failed');
  const finished = !pending && items.length > 0;

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
          begin(files);
        }}
      />
      <button type="button" className="btn btn-primary btn-small" disabled={pending} onClick={() => input.current?.click()}>
        <PlusIcon className="icon" />
        {pending ? 'Uploading…' : 'Upload files'}
      </button>

      {collisions && (
        <div className="upload-toast" role="alertdialog" aria-labelledby="upload-collisions">
          <p id="upload-collisions" className="upload-toast-title">
            {collisions.length === 1 ? `${collisions[0]!.name} is already here.` : `${collisions.length} of these files are already here.`}
          </p>
          <p className="muted">Save {collisions.length === 1 ? 'it' : 'them'} as the next revision, or skip {collisions.length === 1 ? 'it' : 'them'} and upload the rest.</p>
          {collisions.length > 1 && <p className="mono upload-toast-names">{collisions.map((file) => file.name).join(', ')}</p>}
          <div className="upload-toast-actions">
            <button type="button" className="btn btn-primary btn-small" onClick={() => upload(queued, true)}>Save as new revisions</button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => upload(queued, false)}>{collisions.length === 1 ? 'Skip it' : 'Skip them'}</button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setCollisions(null)}>Cancel</button>
          </div>
        </div>
      )}

      {!collisions && items.length > 0 && (
        <div className="upload-toast" role="status" aria-live="polite">
          <p className="upload-toast-title">
            {pending ? `Uploading ${Math.min(done + failed.length + 1, items.length)} of ${items.filter((item) => item.phase !== 'skipped').length}…` : failed.length ? `Uploaded ${done} of ${done + failed.length}.` : `Uploaded ${done} ${done === 1 ? 'file' : 'files'}.`}
          </p>
          <ul className="upload-list">
            {items.map((item) => (
              <li key={item.name} className={`upload-item is-${item.phase}`}>
                <span className="mono upload-name">{item.name}</span>
                <span className="upload-state">
                  {item.phase === 'waiting' ? 'Waiting' : item.phase === 'hashing' ? 'Reading' : item.phase === 'uploading' ? `${Math.round(item.progress * 100)}%` : item.phase === 'saving' ? 'Saving' : item.phase === 'done' ? 'Done' : item.phase === 'skipped' ? 'Skipped' : 'Failed'}
                </span>
                {(item.phase === 'uploading' || item.phase === 'saving') && <span className="upload-bar" style={{ '--progress': item.progress } as React.CSSProperties} />}
                {item.error && item.error !== 'Out of storage' && <span className="upload-error">{item.error}</span>}
              </li>
            ))}
          </ul>
          {full && (
            <p className="upload-full" role="alert">
              {owner.isYou ? (
                <>
                  You’re out of storage{full.quotaBytes ? `: ${formatBytes(full.usedBytes)} of ${formatBytes(full.quotaBytes)} used` : ''}.{' '}
                  <Link href={`/settings/billing?from=${encodeURIComponent(window.location.pathname)}`}>Upgrade your plan</Link> or delete old projects to keep uploading.
                </>
              ) : (
                <>@{owner.handle} is out of storage, so uploads to this project are paused. Ask them to free up space or upgrade their plan.</>
              )}
            </p>
          )}
          {finished && (
            <button type="button" className="btn btn-secondary btn-small upload-toast-close" onClick={() => setItems([])}>
              Close
            </button>
          )}
        </div>
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
            const uploaded = await uploadContents(projectId, file, (phase, progress) =>
              setStatus({ message: phase === 'uploading' ? `Uploading ${file.name}: ${Math.round(progress * 100)}%` : phase === 'hashing' ? `Reading ${file.name}…` : 'Saving…' }),
            );
            if (uploaded.storageFull) setStatus({ error: 'The project owner is out of storage. Free up space or upgrade the plan to upload.' });
            else setStatus(uploaded.sha256 ? await replaceRootFile(projectId, entryId, uploaded.sha256) : { error: uploaded.error });
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
