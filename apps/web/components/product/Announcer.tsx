'use client';

import { useEffect, useState, type ReactNode } from 'react';

const listeners = new Set<(message: ReactNode) => void>();

/**
 * Shows an action's result in the page's status region, which outlives the control that
 * produced it. Returns false when no region is on the page, so the caller can show it itself.
 */
export function announce(message: ReactNode): boolean {
  for (const listener of listeners) listener(message);
  return listeners.size > 0;
}

const SHOWN_MS = 8000;

/** The page's status region: the latest action result, for a few seconds. */
export function Announcer() {
  const [message, setMessage] = useState<{ text: ReactNode; at: number } | null>(null);
  useEffect(() => {
    const listener = (text: ReactNode) => setMessage({ text, at: Date.now() });
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [message]);
  // The region stays in the page so screen readers hear each new message.
  return (
    <div className="action-toast-region" role="status" aria-live="polite">
      {message && (
        <p key={message.at} className="action-toast">
          {message.text}
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setMessage(null)}>
            ×
          </button>
        </p>
      )}
    </div>
  );
}
