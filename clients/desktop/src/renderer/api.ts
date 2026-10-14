// The window's side of the bridge in src/preload: typed commands and the app state.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Bridge, Navigate } from '../preload/index.js';
import type { AppState, CommandName, Commands, GigaErrorInfo } from '../shared/types.js';

declare global {
  interface Window {
    gigacad: Bridge;
  }
}

/** A command failed; `hint` is giga's suggestion, when it has one. */
export class CommandError extends Error implements GigaErrorInfo {
  readonly code: string;
  readonly hint: string | undefined;

  constructor(info: GigaErrorInfo) {
    super(info.message);
    this.code = info.code;
    this.hint = info.hint;
  }
}

type Result<K extends CommandName> = Awaited<ReturnType<Commands[K]>>;

export async function call<K extends CommandName>(name: K, ...args: Parameters<Commands[K]>): Promise<Result<K>> {
  const result = await window.gigacad.command(name, ...args);
  if (!result.ok) throw new CommandError(result.error);
  return result.value as Result<K>;
}

// --- Toasts ------------------------------------------------------------------------------

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly hint?: string | undefined;
  readonly error: boolean;
}

let toasts: readonly Toast[] = [];
let nextToast = 1;
const toastListeners = new Set<() => void>();
/** Each toast's timer: how long it has left, and when that count started. */
const timers = new Map<number, { left: number; since: number; handle: ReturnType<typeof setTimeout> | undefined }>();

export function toast(text: string, options: { hint?: string | undefined; error?: boolean } = {}): void {
  const id = nextToast++;
  toasts = [...toasts, { id, text, hint: options.hint, error: options.error ?? false }].slice(-4);
  toastListeners.forEach((listener) => listener());
  timers.set(id, { left: options.error ? 9000 : 4000, since: Date.now(), handle: undefined });
  resumeToast(id);
}

export function dismissToast(id: number): void {
  clearTimeout(timers.get(id)?.handle);
  timers.delete(id);
  toasts = toasts.filter((item) => item.id !== id);
  toastListeners.forEach((listener) => listener());
}

/** While the pointer or focus is on a toast it stays. */
export function pauseToast(id: number): void {
  const timer = timers.get(id);
  if (!timer?.handle) return;
  clearTimeout(timer.handle);
  timers.set(id, { left: Math.max(1000, timer.left - (Date.now() - timer.since)), since: Date.now(), handle: undefined });
}

export function resumeToast(id: number): void {
  const timer = timers.get(id);
  if (!timer || timer.handle) return;
  timers.set(id, { ...timer, since: Date.now(), handle: setTimeout(() => dismissToast(id), timer.left) });
}

export const useToasts = () =>
  useSyncExternalStore(
    (listener) => {
      toastListeners.add(listener);
      return () => void toastListeners.delete(listener);
    },
    () => toasts,
  );

/** Runs a command and shows its error as a toast. Resolves whether it succeeded. */
export async function act<K extends CommandName>(name: K, ...args: Parameters<Commands[K]>): Promise<boolean> {
  try {
    await call(name, ...args);
    return true;
  } catch (error) {
    if (error instanceof CommandError) toast(error.message, { hint: error.hint, error: true });
    else toast(error instanceof Error ? error.message : String(error), { error: true });
    return false;
  }
}

// --- State -------------------------------------------------------------------------------

/** The app's state, pushed by the main process whenever it changes. */
export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    const off = window.gigacad.onState(setState);
    void call('getState').then((initial) => setState((current) => current ?? initial));
    return off;
  }, []);
  return state;
}

export function useNavigate(listener: (to: Navigate) => void): void {
  useEffect(() => window.gigacad.onNavigate(listener), [listener]);
}

/** Loads data for a view and reloads it when `deps` change; errors show inline. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): { data: T | undefined; error: CommandError | undefined; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<CommandError | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    load().then(
      (value) => {
        if (!live) return;
        setData(value);
        setError(undefined);
        setLoading(false);
      },
      (failure: unknown) => {
        if (!live) return;
        setError(failure instanceof CommandError ? failure : new CommandError({ code: 'internal', message: String(failure) }));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((value) => value + 1) };
}

// --- Formatting --------------------------------------------------------------------------

/** Re-renders every half minute, so relative times ("2 min ago") stay true. */
export function useTicking(interval = 30_000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), interval);
    return () => clearInterval(timer);
  }, [interval]);
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
