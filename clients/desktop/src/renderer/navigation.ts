// Where the window is: the selection with back/forward history, kept in localStorage so the
// window reopens where it was, and each view's last tab.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Selection } from './view.js';

const SELECTION = 'gigacad.selection';

function load<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the window then starts from the first project.
  }
}

/** The selection with history. `select` adds to the history; back and forward move through it. */
export function useNavigation() {
  const [history, setHistory] = useState<{ entries: Selection[]; at: number }>(() => {
    const saved = load<Selection>(SELECTION, { kind: 'none' });
    // A commit focus is a one-time request, not a place to come back to.
    return { entries: [saved.kind === 'project' ? { ...saved, commit: undefined } : saved], at: 0 };
  });
  const selection = history.entries[history.at]!;
  useEffect(() => save(SELECTION, selection.kind === 'project' ? { ...selection, commit: undefined } : selection), [selection]);

  const select = useCallback((next: Selection) => {
    setHistory(({ entries, at }) => {
      if (JSON.stringify(entries[at]) === JSON.stringify(next)) return { entries, at };
      const kept = [...entries.slice(0, at + 1), next].slice(-50);
      return { entries: kept, at: kept.length - 1 };
    });
  }, []);
  const back = useCallback(() => setHistory(({ entries, at }) => ({ entries, at: Math.max(0, at - 1) })), []);
  const forward = useCallback(() => setHistory(({ entries, at }) => ({ entries, at: Math.min(entries.length - 1, at + 1) })), []);
  return { selection, select, back, forward, canGoBack: history.at > 0, canGoForward: history.at < history.entries.length - 1 };
}

/** A tab that the view reopens on, per kind of view ("project", "branch"). */
export function useSavedTab<T extends string>(view: string, allowed: readonly T[], initial: T): [T, (tab: T) => void] {
  const key = `gigacad.tab.${view}`;
  const [tab, setTab] = useState<T>(() => {
    const saved = load<string>(key, initial);
    return (allowed as readonly string[]).includes(saved) ? (saved as T) : initial;
  });
  const choose = useCallback(
    (next: T) => {
      setTab(next);
      save(key, next);
    },
    [key],
  );
  return [tab, choose];
}

/** Owner groups the person collapsed in the sidebar. */
export function useCollapsed(): [readonly string[], (owner: string) => void] {
  const [collapsed, setCollapsed] = useState<string[]>(() => load<string[]>('gigacad.collapsed', []));
  const toggle = useCallback((owner: string) => {
    setCollapsed((current) => {
      const next = current.includes(owner) ? current.filter((candidate) => candidate !== owner) : [...current, owner];
      save('gigacad.collapsed', next);
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

// --- Refresh -----------------------------------------------------------------------------

let refreshes = 0;
const refreshListeners = new Set<() => void>();

/** Mod+R: views reload what they loaded (useLoad watches this). */
export function refreshViews(): void {
  refreshes += 1;
  refreshListeners.forEach((listener) => listener());
}

export const useRefreshes = () =>
  useSyncExternalStore(
    (listener) => {
      refreshListeners.add(listener);
      return () => void refreshListeners.delete(listener);
    },
    () => refreshes,
  );

// --- Window-wide requests ----------------------------------------------------------------

type Request = 'commit' | 'filter';
const requestListeners = new Map<Request, Set<() => void>>();

/** Asks whichever view can do it (the commit box, the sidebar filter) to act. Returns whether one did. */
export function request(kind: Request): boolean {
  const listeners = requestListeners.get(kind);
  listeners?.forEach((listener) => listener());
  return (listeners?.size ?? 0) > 0;
}

export function useRequest(kind: Request, listener: () => void): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    const run = () => latest.current();
    const listeners = requestListeners.get(kind) ?? new Set();
    listeners.add(run);
    requestListeners.set(kind, listeners);
    return () => void listeners.delete(run);
  }, [kind]);
}
