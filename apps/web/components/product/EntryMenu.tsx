'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { moveEntryTo, removeEntry, renameEntry } from '../../app/(product)/actions';

/** A root file or folder the menu acts on, read from its row's `data-entry-*` attributes. */
interface Target {
  id: string;
  kind: 'file' | 'folder';
  name: string;
  path: string;
  href: string;
}

type Mode = 'menu' | 'rename' | 'move';

const LONG_PRESS_MS = 550;

/**
 * The right-click menu for root files and folders: open, rename, move, and delete. Rows opt in
 * with `data-entry-id` and friends. Touch screens open it with a long press, and keyboards with
 * the context-menu key or Shift+F10.
 */
export function EntryMenu({ projectId, folders, children }: { projectId: string; folders: { id: string; path: string }[]; children: ReactNode }) {
  const router = useRouter();
  const [target, setTarget] = useState<Target | null>(null);
  const [mode, setMode] = useState<Mode>('menu');
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const menu = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const press = useRef<{ timer: number; fired: boolean } | null>(null);

  const close = (restoreFocus = true) => {
    setTarget(null);
    setError('');
    if (restoreFocus) opener.current?.focus();
  };

  const open = (row: HTMLElement, x: number, y: number) => {
    const { entryId, entryKind, entryName, entryPath, entryHref } = row.dataset;
    if (!entryId || !entryName || !entryPath || !entryHref) return;
    opener.current = (row.querySelector('a') as HTMLElement | null) ?? row;
    setTarget({ id: entryId, kind: entryKind === 'folder' ? 'folder' : 'file', name: entryName, path: entryPath, href: entryHref });
    setMode('menu');
    setError('');
    setPoint({ x, y });
    setPlace(null);
  };

  const rowAt = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>('tr[data-entry-id]') : null);

  // Kept inside the viewport once its size is known.
  useLayoutEffect(() => {
    if (!target || !menu.current) return;
    const { width, height } = menu.current.getBoundingClientRect();
    setPlace({
      left: Math.max(8, Math.min(point.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(point.y, window.innerHeight - height - 8)),
    });
  }, [target, mode, point]);

  useEffect(() => {
    if (!target) return;
    (menu.current?.querySelector<HTMLElement>('input, [role="menuitem"]:not(:disabled)') ?? menu.current)?.focus();
  }, [target, mode]);

  useEffect(() => {
    if (!target) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      close(false);
    };
    const dismiss = () => close(false);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [target]);

  const run = (action: () => Promise<{ error?: string }>) =>
    start(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else close();
    });

  // Escape steps back from rename or move to the menu, then closes it, wherever focus is.
  useEffect(() => {
    if (!target) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (mode === 'menu') close();
      else setMode('menu');
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [target, mode]);

  const keys = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]!.focus();
  };

  // A folder can't move into itself or anything inside it.
  const destinations = target
    ? folders.filter((folder) => target.kind === 'file' || (folder.path !== target.path && !folder.path.startsWith(`${target.path}/`)))
    : [];
  const currentParent = target?.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : '';

  return (
    <div
      className="entry-menu-scope"
      onContextMenu={(event) => {
        const row = rowAt(event.target);
        if (!row) return;
        event.preventDefault();
        // The keyboard's context-menu key reports no pointer position; open by the row instead.
        if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) || (event.clientX === 0 && event.clientY === 0)) {
          const rect = row.getBoundingClientRect();
          open(row, rect.left + 24, rect.bottom);
        } else open(row, event.clientX, event.clientY);
      }}
      onTouchStart={(event) => {
        const row = rowAt(event.target);
        if (!row || event.touches.length !== 1) return;
        const { clientX, clientY } = event.touches[0]!;
        const timer = window.setTimeout(() => {
          press.current = { timer, fired: true };
          open(row, clientX, clientY);
        }, LONG_PRESS_MS);
        press.current = { timer, fired: false };
      }}
      onTouchMove={() => {
        if (press.current && !press.current.fired) window.clearTimeout(press.current.timer);
      }}
      onTouchEnd={(event) => {
        if (!press.current) return;
        window.clearTimeout(press.current.timer);
        // The press opened the menu, so the tap that ends it doesn't follow the row's link.
        if (press.current.fired) event.preventDefault();
        press.current = null;
      }}
    >
      {children}
      {target && (
        <div
          ref={menu}
          className="menu-list entry-menu"
          role={mode === 'rename' ? 'dialog' : 'menu'}
          aria-label={mode === 'rename' ? `Rename ${target.name}` : mode === 'move' ? `Move ${target.name} to` : `Actions for ${target.name}`}
          tabIndex={-1}
          style={{ position: 'fixed', margin: 0, left: place?.left ?? point.x, top: place?.top ?? point.y, visibility: place ? 'visible' : 'hidden' }}
          onKeyDown={keys}
        >
          {mode === 'menu' && (
            <>
              <p className="entry-menu-title mono">{target.name}</p>
              <button type="button" role="menuitem" onClick={() => (close(false), router.push(target.href))}>
                {target.kind === 'folder' ? 'Open' : 'Revisions and details'}
              </button>
              <button type="button" role="menuitem" onClick={() => setMode('rename')}>
                Rename…
              </button>
              <button type="button" role="menuitem" onClick={() => setMode('move')}>
                Move to…
              </button>
              <hr />
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                disabled={pending}
                onClick={() => {
                  const what = target.kind === 'folder' ? `${target.path} and everything in it` : `${target.path} and every revision`;
                  if (window.confirm(`Delete ${what}? This can’t be undone.`)) run(() => removeEntry(projectId, target.id));
                }}
              >
                Delete
              </button>
            </>
          )}
          {mode === 'rename' && (
            <form
              className="entry-menu-form"
              onSubmit={(event) => {
                event.preventDefault();
                const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
                if (!name || name === target.name) return close();
                run(() => renameEntry(projectId, target.id, name));
              }}
            >
              <label className="field">
                <span>Name</span>
                <input
                  name="name"
                  required
                  maxLength={255}
                  defaultValue={target.name}
                  autoComplete="off"
                  // Selects the name without its extension, as file managers do.
                  onFocus={(event) => {
                    const dot = target.kind === 'file' ? target.name.lastIndexOf('.') : -1;
                    event.currentTarget.setSelectionRange(0, dot > 0 ? dot : target.name.length);
                  }}
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary btn-small" disabled={pending}>
                  Rename
                </button>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setMode('menu')}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          {mode === 'move' && (
            <>
              <p className="entry-menu-title">Move {target.name} to</p>
              <div className="entry-menu-scroll">
                {[{ id: null, path: '' } as { id: string | null; path: string }, ...destinations].map((folder) => (
                  <button
                    key={folder.id ?? 'root'}
                    type="button"
                    role="menuitem"
                    className="mono"
                    disabled={pending || folder.path === currentParent}
                    aria-current={folder.path === currentParent ? 'true' : undefined}
                    onClick={() => run(() => moveEntryTo(projectId, target.id, folder.id))}
                  >
                    {folder.path || 'Project root'}
                  </button>
                ))}
              </div>
            </>
          )}
          {error && (
            <p className="form-status is-error entry-menu-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
