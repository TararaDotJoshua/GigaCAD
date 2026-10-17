import { useEffect, useRef, type RefObject } from 'react';

/** The close function of the popover that's open now, so opening another closes it. */
let current: (() => void) | null = null;

/**
 * Popover behavior shared by menus, pickers and inline confirms: Escape closes it and puts
 * focus back on `trigger` (or wherever `close` puts it), a press outside `scope` closes it
 * where it stands, and only one is open at a time.
 */
export function useDismiss(open: boolean, scope: RefObject<HTMLElement | null>, close: (how: 'escape' | 'outside') => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const shut = () => latest.current('outside');
    if (current && current !== shut) current();
    current = shut;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      latest.current('escape');
    };
    const outside = (event: Event) => {
      if (event.target instanceof Node && scope.current?.contains(event.target)) return;
      latest.current('outside');
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      if (current === shut) current = null;
      document.removeEventListener('keydown', escape);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [open, scope]);
}

/** `useDismiss` for a `<details>` popover: closes it, and on Escape focuses its summary. */
export function useDismissDetails(open: boolean, details: RefObject<HTMLDetailsElement | null>): void {
  useDismiss(open, details, (how) => {
    const element = details.current;
    if (!element) return;
    element.open = false;
    if (how === 'escape') element.querySelector('summary')?.focus();
  });
}
