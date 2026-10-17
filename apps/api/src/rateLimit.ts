import { HttpError } from './errors.js';

/**
 * A fixed-window counter per key, in memory. Enough for one API instance; it bounds abuse
 * of unauthenticated endpoints such as starting a device sign-in.
 */
export function createRateLimit(options: { limit: number; windowMs: number }): (key: string) => void {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return (key) => {
    const now = Date.now();
    let window = windows.get(key);
    if (!window || window.resetAt <= now) {
      if (windows.size > 50_000) for (const [stale, entry] of windows) if (entry.resetAt <= now) windows.delete(stale);
      window = { count: 0, resetAt: now + options.windowMs };
      windows.set(key, window);
    }
    window.count++;
    if (window.count > options.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
      throw new HttpError(429, 'rate_limited', 'Too many tries. Wait a minute and try again.', { retryAfterSeconds });
    }
  };
}
