import { useSyncExternalStore } from 'react';

const noSubscription = () => () => {};

/**
 * False in the server's HTML and until the page hydrates, then true. Forms keep their submit
 * button disabled until then, so an early Enter can't submit them natively (and, with a GET,
 * put what was typed in the address bar).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
