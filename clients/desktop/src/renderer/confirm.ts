// Asking before an action that loses something, for actions chosen from a native right-click
// menu (which can't ask in place): a small panel at the pointer, the same sentence-and-button as
// ActionButton's `confirm` and the ⋯ menu's.
import { useSyncExternalStore } from 'react';

export interface Question {
  readonly sentence: string;
  readonly label: string;
  readonly danger: boolean;
  readonly onConfirm: () => void;
  readonly x: number;
  readonly y: number;
}

let question: Question | null = null;
const listeners = new Set<() => void>();

export function ask(next: Question | null): void {
  question = next;
  listeners.forEach((listener) => listener());
}

export const useQuestion = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => question,
  );
