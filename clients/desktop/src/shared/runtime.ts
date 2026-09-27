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
}

/** ~/Library/Application Support/GigaCAD: settings, bundles, and caches. Survives reinstalling the app. */
export function supportDir(): string {
  return process.env.GIGACAD_SUPPORT_DIR ?? join(homedir(), 'Library', 'Application Support', 'GigaCAD');
}

export const bundlesDir = () => join(supportDir(), 'bundles');
