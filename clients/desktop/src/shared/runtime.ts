import { homedir } from 'node:os';
import { join } from 'node:path';

/** What the bootstrap hands the code bundle it starts. */
export interface BundleRuntime {
  /** The bundle folder: main/, preload/, renderer/, cli/, icons/. */
  readonly dir: string;
  readonly version: string;
  readonly source: 'downloaded' | 'builtin' | 'dev';
  readonly shellVersion: number;
  readonly bundlesDir: string;
  readonly publicKey: string;
  /** A newer bundle failed to start last time, so this older one runs instead. */
  readonly rolledBackFrom: string | undefined;
  /** Makes this bundle current. Called once the window loaded and syncing started. */
  markHealthy(): void;
  clearRollbackNotice(): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __gigacad: BundleRuntime | undefined;
  /** The bootstrap's handler for a bundle that fails while starting: it rolls back. */
  // eslint-disable-next-line no-var
  var __gigacadStartFailed: ((error: unknown) => void) | undefined;
}

/**
 * Settings, bundles, and caches; survives reinstalling the app. ~/Library/Application Support/GigaCAD
 * on macOS, %LOCALAPPDATA%\GigaCAD on Windows.
 */
export function supportDir(): string {
  if (process.env.GIGACAD_SUPPORT_DIR) return process.env.GIGACAD_SUPPORT_DIR;
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'GigaCAD');
  return join(homedir(), 'Library', 'Application Support', 'GigaCAD');
}

export const bundlesDir = () => join(supportDir(), 'bundles');
