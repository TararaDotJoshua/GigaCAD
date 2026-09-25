/** Handles look like `alex` or `sam-3d`: 1-39 lowercase letters, digits, or dashes, not starting or ending with a dash. */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

/**
 * Product URLs are `app.gigacad.site/<handle>/<project>`, so a handle can't be the
 * name of a top-level page on either site.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'about',
  'admin',
  'api',
  'app',
  'auth',
  'device',
  'docs',
  'download',
  'explore',
  'forgot-password',
  'gigacad',
  'help',
  'login',
  'logout',
  'new',
  'pricing',
  'privacy',
  'reset-password',
  'settings',
  'signup',
  'static',
  'support',
  'terms',
  'www',
]);

export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle.toLowerCase());
}

/** New accounts start with `user-` and 12 hex digits from their id (see the profiles trigger) until they choose a handle. */
const PLACEHOLDER_HANDLE = /^user-[0-9a-f]{12}$/;

export function isPlaceholderHandle(handle: string): boolean {
  return PLACEHOLDER_HANDLE.test(handle);
}
