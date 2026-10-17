// Which activity the person has seen: errors after that mark the sync status and Activity tab.
// Kept per window in localStorage, since the main process doesn't need it.
import { createContext, useSyncExternalStore } from 'react';
import type { ActivityItem } from '../shared/types.js';
import type { Selection } from './view.js';

const KEY = 'gigacad.activitySeenAt';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

let seenAt = read();

export function markActivitySeen(at = new Date().toISOString()): void {
  if (at <= seenAt) return;
  seenAt = at;
  try {
    localStorage.setItem(KEY, at);
  } catch {
    // Private storage can refuse; the marks then reset with the window.
  }
  listeners.forEach((listener) => listener());
}

export const useActivitySeenAt = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => seenAt,
  );

/** Errors that arrived after the person last looked. ISO times compare as strings. */
export const unreadErrors = (items: readonly ActivityItem[], seen: string) => items.filter((item) => item.kind === 'error' && item.at > seen);

/** Opens a view from anywhere in the window (activity links, notices). */
export const SelectContext = createContext<(selection: Selection) => void>(() => {});
