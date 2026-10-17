'use client';

import { formatBytes } from '@gigacad/core';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { addRootFile, findRootFile, replaceRootFile, type ActionState } from '../../app/(product)/actions';
import { differentExtension, uploadTitle } from '../../lib/directory';
import { safeAction } from '../../lib/safe-action';
import { uploadContents, type UploadPhase } from '../../lib/upload';
import { PlusIcon } from '../icons';
import { OPEN_UPLOAD_EVENT } from './OpenUploadButton';

/** Files dropped anywhere on the folder's drop zone arrive as this event. */
export const DROP_FILES_EVENT = 'gigacad:drop-files';

/** What a drop hands the uploader: the files, and the names of folders it can't take. */
export interface DroppedFiles {
  readonly files: File[];
  readonly folders: string[];
}

interface Item {
  readonly id: number;
  readonly name: string;
  readonly phase: UploadPhase | 'waiting' | 'done' | 'failed' | 'skipped' | 'taken';
  readonly progress: number;
  readonly error?: string;
}

interface Job {
  readonly id: number;
  readonly file: File;
  /** Save it as the next revision of the file already named like it. */
  readonly replace: boolean;
}

/** Who pays for the project's storage, to word a storage-full refusal. */
export interface StorageOwner {
  readonly handle: string;
  readonly isYou: boolean;
}

/** Asks before closing or reloading the tab while `active`, so a running upload isn't cut off. */
function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

/**
 * Adds files to a root folder, one after another, with progress for each. Files named
 * like one already here become that file's next revision, after asking once for the batch.
 * Files dropped while an upload runs wait their turn. A failed file doesn't stop the rest,
 * except a full storage quota, which stops them all.
 *
 * The upload runs outside a transition: inside one, every navigation waited for it to finish.
 */
export function UploadFiles({
  projectId,
  parentId,
  folderPath,
  existing,
  owner,
  storageFull = false,
}: {
  projectId: string;
  parentId: string | null;
  /** The folder's path from the project root, empty at the root. */
  folderPath: string;
  /** Lowercased names of files on the page, to their entry ids. Names on other pages are found when the API refuses them. */
  existing: Record<string, string>;
  owner: StorageOwner;
  /** The owner's storage is already full: say so beside the button. */
  storageFull?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [collisions, setCollisions] = useState<{ files: File[]; ids: number[] } | null>(null);
  const [full, setFull] = useState<ActionState['storageFull']>();
  const queue = useRef<Job[]>([]);
  const running = useRef(false);
  const nextId = useRef(0);
  // Files already uploaded whose names turned out to be taken, with the entry they collided with.
  const resolved = useRef(new Map<File, { sha256: string; entryId: string | null }>());
  useLeaveWarning(pending);

  // The name-collision question takes focus, so keyboard users can answer it.
  useEffect(() => {
    if (collisions) dialog.current?.querySelector<HTMLElement>('button')?.focus();
  }, [collisions]);

  useEffect(() => {
    const open = () => input.current?.click();
    const drop = (event: Event) => {
      const { files, folders } = (event as CustomEvent<DroppedFiles>).detail;
      if (folders.length) {
        setItems((current) => [
          ...(running.current ? current : current.filter((item) => item.phase === 'waiting')),
          ...folders.map((name) => ({ id: nextId.current++, name, phase: 'skipped' as const, progress: 0, error: 'Folders can’t be uploaded here. Open the folder and drop its files.' })),
        ]);
      }
      begin(files);
    };
    window.addEventListener(OPEN_UPLOAD_EVENT, open);
    window.addEventListener(DROP_FILES_EVENT, drop);
    return () => {
      window.removeEventListener(OPEN_UPLOAD_EVENT, open);
      window.removeEventListener(DROP_FILES_EVENT, drop);
    };
  });

  const update = (id: number, change: Partial<Item>) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));

  function begin(files: File[]) {
    if (!files.length) return;
    // Mid-upload or mid-question, new files join the queue; any named like a file here are asked about after.
    if (running.current || collisions) return enqueue(files, false, true);
    const taken = files.filter((file) => existing[file.name.toLowerCase()]);
    if (taken.length) {
      setItems([]);
      const ids = files.map(() => nextId.current++);
      setCollisions({ files, ids });
    } else {
      setItems([]);
      enqueue(files, false);
    }
  }

  /** Adds files to the queue as Waiting, and starts working through it if nothing is running. */
  function enqueue(files: File[], replace: boolean, keep = true, ids = files.map(() => nextId.current++)) {
    setFull(undefined);
    const jobs = files.map((file, index) => ({ id: ids[index]!, file, replace }));
    queue.current.push(...jobs);
    setItems((current) => [...(keep ? current.filter((item) => !ids.includes(item.id)) : []), ...jobs.map((job) => ({ id: job.id, name: job.file.name, phase: 'waiting' as const, progress: 0 }))]);
    if (!running.current) void run();
  }

  /** Answers the "already here" question for a batch: revisions for all of them, or skip the ones that are here. */
  function answer(replace: boolean) {
    if (!collisions) return;
    const { files, ids } = collisions;
    setCollisions(null);
    const keep = files.flatMap((file, index) => (replace || !(existing[file.name.toLowerCase()] || resolved.current.get(file)?.entryId) ? [index] : []));
    const skipped = ids.filter((_, index) => !keep.includes(index));
    setItems((current) => [
      ...current.filter((item) => !ids.includes(item.id)),
      ...files.flatMap((file, index) => (skipped.includes(ids[index]!) ? [{ id: ids[index]!, name: file.name, phase: 'skipped' as const, progress: 0 }] : [])),
    ]);
    enqueue(
      keep.map((index) => files[index]!),
      replace,
      true,
      keep.map((index) => ids[index]!),
    );
  }

  async function run() {
    running.current = true;
    setPending(true);
    const late: { file: File; id: number }[] = [];
    try {
      while (queue.current.length > 0) {
        const job = queue.current.shift()!;
        const { file, id } = job;
        const known = resolved.current.get(file);
        const replacing = existing[file.name.toLowerCase()] ?? known?.entryId ?? null;
        const uploaded = known ? { sha256: known.sha256 } : await safeAction(() => uploadContents(projectId, file, (phase, progress) => update(id, { phase, progress })));
        update(id, { phase: 'saving', progress: 1 });
        const sha256 = uploaded.sha256;
        const result: ActionState & { readonly taken?: boolean } = sha256
          ? replacing && (job.replace || known)
            ? await safeAction(() => replaceRootFile(projectId, replacing, sha256))
            : replacing
              ? { taken: true }
              : await safeAction<ActionState & { readonly taken?: boolean }>(() => addRootFile(projectId, parentId, file.name, sha256))
          : uploaded;
        if (result.storageFull) {
          // Every other file would be refused too.
          setFull(result.storageFull);
          const rest = queue.current.splice(0).map((other) => other.id);
          setItems((current) => current.map((item) => (item.id === id ? { ...item, phase: 'failed', error: 'Out of storage' } : rest.includes(item.id) ? { ...item, phase: 'skipped' } : item)));
          break;
        }
        if (result.taken && sha256) {
          // Named like a file elsewhere in this folder, such as on another page: ask about it with the rest.
          const entryId = replacing ?? (await findRootFile(projectId, folderPath ? `${folderPath}/${file.name}` : file.name).catch(() => null));
          resolved.current.set(file, { sha256, entryId });
          if (entryId) {
            late.push({ file, id });
            update(id, { phase: 'taken', progress: 0 });
            continue;
          }
        }
        update(id, result.error ? { phase: 'failed', error: result.error } : { phase: 'done', progress: 1 });
      }
    } finally {
      running.current = false;
      setPending(false);
    }
    if (late.length) {
      setCollisions((current) => ({ files: [...(current?.files ?? []), ...late.map((entry) => entry.file)], ids: [...(current?.ids ?? []), ...late.map((entry) => entry.id)] }));
    }
  }

  /** Leaves the files the question was about where they are. */
  function cancel() {
    if (!collisions) return;
    setItems((current) => current.map((item) => (collisions.ids.includes(item.id) ? { ...item, phase: 'skipped' } : item)));
    setCollisions(null);
  }

  const title = uploadTitle(items.map((item) => item.phase));

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
      <button type="button" className="btn btn-primary btn-small" onClick={() => input.current?.click()}>
        <PlusIcon className="icon" />
        {pending ? 'Uploading…' : 'Upload files'}
      </button>
      {storageFull && (
        <span className="muted upload-full-note">
          {/* Files the project already has still upload; anything new is refused. */}
          <StorageFull owner={owner} /> Files already stored here still upload.
        </span>
      )}

      {collisions && (
        <div ref={dialog} className="upload-toast" role="alertdialog" aria-labelledby="upload-collisions" onKeyDown={(event) => event.key === 'Escape' && cancel()}>
          <CollisionQuestion files={collisions.files} existing={existing} resolved={resolved.current} />
          <div className="upload-toast-actions">
            <button type="button" className="btn btn-primary btn-small" onClick={() => answer(true)}>
              Save as new revisions
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => answer(false)}>
              {collisions.files.length === 1 ? 'Skip it' : 'Skip them'}
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!collisions && items.length > 0 && (
        <div className="upload-toast" role="status" aria-live="polite">
          <p className="upload-toast-title">{title}</p>
          <ul className="upload-list">
            {items.map((item) => (
              <li key={item.id} className={`upload-item is-${item.phase}`}>
                <span className="mono upload-name">{item.name}</span>
                <span className="upload-state">
                  {item.phase === 'waiting'
                    ? 'Waiting'
                    : item.phase === 'hashing'
                      ? 'Reading'
                      : item.phase === 'uploading'
                        ? `${Math.round(item.progress * 100)}%`
                        : item.phase === 'saving'
                          ? 'Saving'
                          : item.phase === 'done'
                            ? 'Done'
                            : item.phase === 'skipped'
                              ? 'Skipped'
                              : item.phase === 'taken'
                                ? 'Already here'
                                : 'Failed'}
                </span>
                {(item.phase === 'uploading' || item.phase === 'saving') && <span className="upload-bar" style={{ '--progress': item.progress } as React.CSSProperties} />}
                {item.error && item.error !== 'Out of storage' && <span className="upload-error">{item.error}</span>}
              </li>
            ))}
          </ul>
          {full && (
            <p className="upload-full" role="alert">
              <StorageFull owner={owner} full={full} />
            </p>
          )}
          {!pending && (
            <button type="button" className="btn btn-secondary btn-small upload-toast-close" onClick={() => setItems([])}>
              Close
            </button>
          )}
        </div>
      )}
    </span>
  );
}

function CollisionQuestion({ files, existing, resolved }: { files: File[]; existing: Record<string, string>; resolved: Map<File, { entryId: string | null }> }) {
  const taken = files.filter((file) => existing[file.name.toLowerCase()] || resolved.get(file)?.entryId);
  const one = taken.length === 1;
  return (
    <>
      <p id="upload-collisions" className="upload-toast-title">
        {one ? `${taken[0]!.name} is already here.` : `${taken.length} of these files are already here.`}
      </p>
      <p className="muted">
        Save {one ? 'it' : 'them'} as the next revision, or skip {one ? 'it' : 'them'}
        {taken.length < files.length ? ' and upload the rest' : ''}.
      </p>
      {!one && <p className="mono upload-toast-names">{taken.map((file) => file.name).join(', ')}</p>}
    </>
  );
}

/** Why an upload was refused for storage: the owner gets the way to more, anyone else who to ask. */
function StorageFull({ owner, full }: { owner: StorageOwner; full?: NonNullable<ActionState['storageFull']> }) {
  const path = usePathname();
  if (!owner.isYou) return <>@{owner.handle} is out of storage. Ask them to free up space or upgrade.</>;
  return (
    <>
      {full ? 'Out of storage' : 'Your storage is full'}
      {full?.quotaBytes ? ` (${formatBytes(full.usedBytes)} of ${formatBytes(full.quotaBytes)})` : ''}.{' '}
      <Link href={`/settings/billing?from=${encodeURIComponent(path)}`}>Upgrade</Link>
    </>
  );
}

/** Uploads new contents for one root file, recorded as its next revision. */
export function ReplaceFile({
  projectId,
  entryId,
  name,
  revision,
  owner,
}: {
  projectId: string;
  entryId: string;
  name: string;
  /** The current revision, to tell a real new revision from identical contents. */
  revision: number | null;
  owner: StorageOwner;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  useLeaveWarning(pending);
  const [status, setStatus] = useState<{ error?: string; message?: string; storageFull?: ActionState['storageFull'] }>({});
  // A file of another type, waiting for a yes before it replaces this one.
  const [unlike, setUnlike] = useState<File | null>(null);

  const replace = async (file: File) => {
    setPending(true);
    setStatus({ message: `Uploading ${file.name}…` });
    const uploaded = await safeAction(() =>
      uploadContents(projectId, file, (phase, progress) =>
        setStatus({ message: phase === 'uploading' ? `Uploading ${file.name}: ${Math.round(progress * 100)}%` : phase === 'hashing' ? `Reading ${file.name}…` : 'Saving…' }),
      ),
    );
    const sha256 = uploaded.sha256;
    if (uploaded.storageFull) setStatus({ storageFull: uploaded.storageFull });
    else setStatus(sha256 ? await safeAction(() => replaceRootFile(projectId, entryId, sha256, revision)) : { error: uploaded.error });
    setPending(false);
  };

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
          setStatus({});
          if (differentExtension(name, file.name)) setUnlike(file);
          else void replace(file);
        }}
      />
      <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => input.current?.click()} aria-label={`Replace ${name}`}>
        {pending ? 'Uploading…' : 'Replace…'}
      </button>
      {unlike && (
        <span className="replace-confirm" role="group" aria-label="Confirm the replacement">
          <span>
            Replace <span className="mono">{name}</span> with <span className="mono">{unlike.name}</span>? It’s a different type of file. The name stays {name}.
          </span>
          <span className="form-actions">
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => {
                const file = unlike;
                setUnlike(null);
                void replace(file);
              }}
            >
              Replace
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setUnlike(null)}>
              Cancel
            </button>
          </span>
        </span>
      )}
      {status.storageFull || status.error ? (
        <span className="form-status is-error" role="alert">
          {status.storageFull ? <StorageFull owner={owner} full={status.storageFull} /> : status.error}
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
