import { unstable_rethrow } from 'next/navigation';

/** What to say when the browser's request to the web server failed, so the action never ran or never answered. */
export function failedRequestMessage(online = typeof navigator === 'undefined' || navigator.onLine): string {
  return online ? 'That didn’t go through. Check your connection and try again.' : 'You’re offline. Reconnect, then try again.';
}

/**
 * Runs a server action from the browser. A request that fails (offline, a timeout, a server
 * error) becomes an inline error instead of the page's error screen, so nothing typed or
 * picked on the page is lost. Redirects and not-found still go through to Next.
 */
export async function safeAction<T extends { readonly error?: string }>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    // Every field of an action's result is optional, so an error alone is a valid one.
    return { error: failedRequestMessage() } as T;
  }
}
