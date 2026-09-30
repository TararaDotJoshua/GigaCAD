import { headers } from 'next/headers';
import { safeReturnPath } from './return-path';

/** Set by the proxy on every request: the path and query the visitor asked for. */
export const CURRENT_PATH_HEADER = 'x-gigacad-path';

/** The page being rendered (or the page a server action was posted from), for sign-in return links. */
export async function currentPath(): Promise<string | null> {
  const value = (await headers()).get(CURRENT_PATH_HEADER);
  return value ? safeReturnPath(value, '') || null : null;
}

/** The log-in page, returning to `path` (or the current page) afterwards. */
export async function loginPath(path?: string | null): Promise<string> {
  const back = path ?? (await currentPath());
  return back ? `/login?next=${encodeURIComponent(back)}` : '/login';
}
