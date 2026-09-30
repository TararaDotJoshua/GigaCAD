import ignore from 'ignore';
import { normalizePath } from './paths.js';

/**
 * Temp, lock, and backup files that CAD tools and operating systems write next
 * to real files. These are never versioned. Extend as real save behavior is observed.
 */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  // SolidWorks lock/temp files and backups
  '~$*',
  '*.tmp',
  '*.bak',
  'Backup of *',
  'Backup (*) of *',
  'AutoRecover of *',
  // FreeCAD / LibreOffice
  '*.FCBak',
  '.~lock.*#',
  // Operating systems
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  // macOS AppleDouble files. Custom-icon files ("Icon" plus a carriage return) are matched in
  // createIgnoreMatcher, because gitignore syntax trims the trailing carriage return.
  '._*',
  // GigaCAD Desktop: marks a branch or release folder that isn't downloaded yet
  '.gigacad-placeholder',
];

export type IgnoreMatcher = (path: string) => boolean;

/** Matches the default patterns plus a project's `.gigaignore` contents (gitignore syntax, case-insensitive). */
export function createIgnoreMatcher(gigaignore = ''): IgnoreMatcher {
  const matcher = ignore({ ignorecase: true }).add([...DEFAULT_IGNORE_PATTERNS]).add(gigaignore);
  return (path) => {
    const normalized = normalizePath(path);
    return isMacIconFile(normalized) || matcher.ignores(normalized);
  };
}

/** Finder stores a folder's custom icon in a hidden file named "Icon\r" inside it. */
const isMacIconFile = (path: string) => path === 'Icon\r' || path.endsWith('/Icon\r');
