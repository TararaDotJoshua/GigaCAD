'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { entryContents, moveEntryTo, removeEntry, renameEntry } from '../../app/(product)/actions';
import { deleteSummary, type EntryContents } from '../../lib/directory';
import { treePath } from '../../lib/paths';

/** A root file or folder the menu acts on, read from its row's `data-entry-*` attributes. */
interface Target {
  id: string;
  kind: 'file' | 'folder';
  name: string;
  path: string;
  href: string;
}

type Mode = 'menu' | 'rename' | 'move' | 'delete';

const LONG_PRESS_MS = 550;
const NOTICE_MS = 8000;

/** The part of the window the menu has to stay inside: the visible part, above a phone's keyboard. */
function viewport() {
  const visual = window.visualViewport;
  return visual
    ? { left: visual.offsetLeft, top: visual.offsetTop, width: visual.width, height: visual.height }
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

/**
 * The right-click menu for root files and folders: open, rename, move, and delete. Rows opt in
 * with `data-entry-id` and friends. It also opens from a row's "More actions" button (marked
 * `data-entry-menu-button`), with a long press on touch screens, and from the keyboard's
 * context-menu key or Shift+F10. It follows its row when the page scrolls, and a half-typed
 * rename survives the phone keyboard opening.
 */
export function EntryMenu({
  projectId,
  owner,
  slug,
  folders,
  children,
}: {
  projectId: string;
  owner: string;
  slug: string;
  folders: { id: string; path: string }[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<Target | null>(null);
  const [mode, setMode] = useState<Mode>('menu');
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState('');
  // False when it couldn't be counted.
  const [contents, setContents] = useState<EntryContents | false | null>(null);
  const [notice, setNotice] = useState<{ text: ReactNode; key: number } | null>(null);
  const [pending, start] = useTransition();
  const menu = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // What the menu is pinned to, and where it sat from that element's corner, so it can follow a scroll.
  const anchor = useRef<{ element: HTMLElement; dx: number; dy: number } | null>(null);
  const press = useRef<{ timer: number; fired: boolean } | null>(null);
  const placed = place !== null;

  const close = (restoreFocus = true) => {
    setTarget(null);
    setError('');
    setBusy('');
    if (restoreFocus) opener.current?.focus({ preventScroll: true });
  };

  const open = (row: HTMLElement, x: number, y: number, pinTo: HTMLElement = row) => {
    const { entryId, entryKind, entryName, entryPath, entryHref } = row.dataset;
    if (!entryId || !entryName || !entryPath || !entryHref) return;
    opener.current = (row.querySelector('a') as HTMLElement | null) ?? row;
    const rect = pinTo.getBoundingClientRect();
    anchor.current = { element: pinTo, dx: x - rect.left, dy: y - rect.top };
    setTarget({ id: entryId, kind: entryKind === 'folder' ? 'folder' : 'file', name: entryName, path: entryPath, href: entryHref });
    setMode('menu');
    setError('');
    setFilter('');
    setBusy('');
    setContents(null);
    setPoint({ x, y });
    setPlace(null);
  };

  const rowAt = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>('tr[data-entry-id]') : null);

  // Kept inside the visible viewport once its size is known.
  useLayoutEffect(() => {
    if (!target || !menu.current) return;
    const { width, height } = menu.current.getBoundingClientRect();
    const view = viewport();
    setPlace({
      left: Math.max(view.left + 8, Math.min(point.x, view.left + view.width - width - 8)),
      top: Math.max(view.top + 8, Math.min(point.y, view.top + view.height - height - 8)),
    });
  }, [target, mode, point, contents, error]);

  // Focus moves in once the menu is visible: a hidden menu can't take focus.
  useEffect(() => {
    if (!target || !placed) return;
    (menu.current?.querySelector<HTMLElement>('input, [role="menuitem"]:not(:disabled)') ?? menu.current)?.focus({ preventScroll: true });
  }, [target, mode, placed]);

  useEffect(() => {
    if (!target) return;
    const inside = (node: EventTarget | null) => node instanceof Node && Boolean(menu.current?.contains(node));
    const outside = (event: Event) => {
      if (!inside(event.target)) close(false);
    };
    // A scroll or resize, including a phone keyboard opening, moves the menu along with its row.
    // Only the plain menu closes, and only once its row has gone out of view.
    const follow = (event: Event) => {
      if (inside(event.target)) return;
      const pinned = anchor.current;
      if (!pinned?.element.isConnected) return mode === 'menu' ? close(false) : undefined;
      const rect = pinned.element.getBoundingClientRect();
      const view = viewport();
      if (mode === 'menu' && (rect.bottom < view.top || rect.top > view.top + view.height)) return close(false);
      setPoint({ x: rect.left + pinned.dx, y: rect.top + pinned.dy });
    };
    const blur = () => {
      if (mode === 'menu') close(false);
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    window.visualViewport?.addEventListener('resize', follow);
    window.visualViewport?.addEventListener('scroll', follow);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      window.visualViewport?.removeEventListener('resize', follow);
      window.visualViewport?.removeEventListener('scroll', follow);
      window.removeEventListener('blur', blur);
    };
  }, [target, mode]);

  // What a delete would take with it, so the confirmation can say.
  useEffect(() => {
    if (!target || mode !== 'delete' || contents !== null) return;
    let current = true;
    entryContents(projectId, target.id).then((found) => {
      if (current) setContents(found ?? false);
    });
    return () => {
      current = false;
    };
  }, [target, mode, contents, projectId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const run = (label: string, action: () => Promise<{ error?: string }>, done: ReactNode) => {
    setBusy(label);
    start(async () => {
      const result = await action();
      setBusy('');
      if (result.error) setError(result.error);
      else {
        close();
        setNotice({ text: done, key: Date.now() });
      }
    });
  };

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
    // Tab leaves a menu the way it does a native one: focus goes back to the opener, then on.
    if (event.key === 'Tab' && (mode === 'menu' || mode === 'delete')) return close();
    const typing = event.target instanceof HTMLInputElement;
    if (!['ArrowDown', 'ArrowUp', ...(typing ? [] : ['Home', 'End'])].includes(event.key)) return;
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]!.focus();
  };

  // A folder can't move into itself or anything inside it.
  const destinations = target
    ? [{ id: null, path: '' } as { id: string | null; path: string }, ...folders]
        .filter((folder) => target.kind === 'file' || folder.id === null || (folder.path !== target.path && !folder.path.startsWith(`${target.path}/`)))
        .filter((folder) => !filter.trim() || (folder.path || 'Project root').toLowerCase().includes(filter.trim().toLowerCase()))
    : [];
  const currentParent = target?.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : '';
  const folderLink = (path: string) => (
    <Link href={treePath(owner, slug, path)} className="mono">
      {path || 'the project root'}
    </Link>
  );
  const moveTo = (folder: { id: string | null; path: string }) => {
    if (!target) return;
    const label = folder.path || 'the project root';
    run(`Moving to ${label}…`, () => moveEntryTo(projectId, target.id, folder.id), <>Moved <span className="mono">{target.name}</span> to {folderLink(folder.path)}.</>);
  };

  return (
    <div
      className="entry-menu-scope"
      onClick={(event) => {
        const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-entry-menu-button]') : null;
        const row = rowAt(button);
        if (!button || !row) return;
        event.preventDefault();
        const rect = button.getBoundingClientRect();
        open(row, rect.right - 200, rect.bottom + 4, button);
        opener.current = button;
      }}
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
          aria-label={mode === 'rename' ? `Rename ${target.name}` : mode === 'move' ? `Move ${target.name} to` : mode === 'delete' ? `Delete ${target.name}` : `Actions for ${target.name}`}
          aria-busy={pending || undefined}
          tabIndex={-1}
          style={{ position: 'fixed', margin: 0, left: place?.left ?? point.x, top: place?.top ?? point.y, visibility: place ? 'visible' : 'hidden' }}
          onKeyDown={keys}
          onBlur={(event) => {
            // Focus moving somewhere else on the page closes the menu; the window losing focus doesn't.
            const next = event.relatedTarget;
            if (next instanceof Node && !event.currentTarget.contains(next)) close(false);
          }}
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
              <button type="button" role="menuitem" className="is-danger" disabled={pending} onClick={() => setMode('delete')}>
                Delete…
              </button>
            </>
          )}
          {mode === 'delete' && (
            <div className="entry-menu-form" role="group" aria-label={`Delete ${target.name}`}>
              <p className="entry-menu-title">Delete {target.name}?</p>
              <p className="muted entry-menu-note" aria-live="polite">
                {contents ? deleteSummary(target.kind, contents) : contents === null && target.kind === 'folder' ? 'Counting what’s in this folder…' : target.kind === 'folder' ? 'Everything in this folder is deleted too.' : 'Every revision of this file is deleted.'}{' '}
                This can’t be undone.
                Branches and releases keep their own copies.
              </p>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                disabled={pending}
                onClick={() => run('Deleting…', () => removeEntry(projectId, target.id), <>Deleted <span className="mono">{target.path}</span>.</>)}
              >
                {busy || 'Delete permanently'}
              </button>
              <button type="button" role="menuitem" onClick={() => setMode('menu')}>
                Cancel
              </button>
            </div>
          )}
          {mode === 'rename' && (
            <form
              className="entry-menu-form"
              onSubmit={(event) => {
                event.preventDefault();
                const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
                if (!name || name === target.name) return close();
                run('Renaming…', () => renameEntry(projectId, target.id, name), <>Renamed <span className="mono">{target.name}</span> to <span className="mono">{name}</span>.</>);
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
                  {busy || 'Rename'}
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
              <label className="field entry-menu-filter">
                <span className="sr-only">Filter folders</span>
                <input
                  type="search"
                  value={filter}
                  placeholder="Filter folders"
                  autoComplete="off"
                  onChange={(event) => setFilter(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    const first = destinations.find((folder) => folder.path !== currentParent);
                    if (first && !pending) moveTo(first);
                  }}
                />
              </label>
              <div className="entry-menu-scroll">
                {destinations.map((folder) => (
                  <button
                    key={folder.id ?? 'root'}
                    type="button"
                    role="menuitem"
                    className="mono"
                    disabled={pending || folder.path === currentParent}
                    aria-current={folder.path === currentParent ? 'true' : undefined}
                    onClick={() => moveTo(folder)}
                  >
                    {folder.path || 'Project root'}
                    {folder.path === currentParent && <span className="muted"> (here now)</span>}
                  </button>
                ))}
                {destinations.length === 0 && <p className="muted entry-menu-note">No folders match.</p>}
              </div>
              {busy && (
                <p className="muted entry-menu-note" role="status">
                  {busy}
                </p>
              )}
            </>
          )}
          {error && (
            <p className="form-status is-error entry-menu-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      <div className="entry-menu-notice" role="status" aria-live="polite">
        {notice && (
          <p key={notice.key} className="upload-toast">
            <span>{notice.text}</span>
          </p>
        )}
      </div>
    </div>
  );
}
