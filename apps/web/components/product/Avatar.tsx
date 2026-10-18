import { isPlaceholderHandle } from '@gigacad/core';

/**
 * A user's picture, or the first letter of their handle on Moss when they haven't uploaded
 * one. A generated `user-…` handle isn't theirs yet, so it shows a question mark everywhere.
 */
export function Avatar({ handle, url, size = 'sm' }: { handle: string; url: string | null | undefined; size?: 'sm' | 'lg' }) {
  const className = size === 'lg' ? 'avatar avatar-lg' : 'avatar';
  const pixels = size === 'lg' ? 240 : 22;
  return url ? (
    <img className={className} src={url} alt="" width={pixels} height={pixels} decoding="async" />
  ) : (
    <span className={className} aria-hidden="true">
      {isPlaceholderHandle(handle) ? '?' : handle.slice(0, 1).toUpperCase()}
    </span>
  );
}
