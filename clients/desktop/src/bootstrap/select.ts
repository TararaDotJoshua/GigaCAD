import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, verifyBundle, type BundleManifest } from '../shared/bundle.js';

/**
 * `bundles/state.json`. `current` is the last bundle that started healthily and `previous`
 * the one before it. `pending` is a bundle launched for the first time that hasn't proved
 * healthy yet; if the app dies while it's pending, the next launch marks it bad.
 */
export interface BundleState {
  current?: string | undefined;
  previous?: string | undefined;
  pending?: string | undefined;
  bad: string[];
  /** Set when a pending bundle failed; the sidebar says so until dismissed. */
  rolledBackFrom?: string | undefined;
}

export interface BundleChoice {
  readonly dir: string;
  readonly version: string;
  readonly source: 'downloaded' | 'builtin';
  readonly manifest: BundleManifest;
  readonly rolledBackFrom: string | undefined;
}

const STATE_FILE = 'state.json';
const VERSION_DIR = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function readState(bundlesDir: string): BundleState {
  try {
    const parsed = JSON.parse(readFileSync(join(bundlesDir, STATE_FILE), 'utf8')) as Partial<BundleState>;
    return { ...parsed, bad: Array.isArray(parsed.bad) ? parsed.bad : [] };
  } catch {
    return { bad: [] };
  }
}

export function writeState(bundlesDir: string, state: BundleState): void {
  mkdirSync(bundlesDir, { recursive: true, mode: 0o700 });
  const target = join(bundlesDir, STATE_FILE);
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temp, target);
}

/** Downloaded bundle versions, newest first. */
export function downloadedVersions(bundlesDir: string): string[] {
  if (!existsSync(bundlesDir)) return [];
  return readdirSync(bundlesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && VERSION_DIR.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => compareVersions(b, a));
}

export interface ChooseOptions {
  readonly bundlesDir: string;
  readonly builtInDir: string;
  readonly shellVersion: number;
  readonly publicKey: string;
}

/**
 * Picks the bundle to run: the newest downloaded bundle that isn't bad, fits this shell, and
 * verifies, unless the built-in bundle is at least as new. Records a failed pending bundle
 * as bad (the rollback) and a newly chosen one as pending. Returns undefined only when even
 * the built-in bundle fails verification.
 */
export function chooseBundle(options: ChooseOptions): BundleChoice | undefined {
  const { bundlesDir, builtInDir, shellVersion, publicKey } = options;
  const state = readState(bundlesDir);
  if (state.pending) {
    if (!state.bad.includes(state.pending)) state.bad.push(state.pending);
    state.rolledBackFrom = state.pending;
    state.pending = undefined;
  }

  const builtIn = verifyBundle(builtInDir, publicKey);
  let choice: BundleChoice | undefined;
  for (const version of downloadedVersions(bundlesDir)) {
    if (state.bad.includes(version)) continue;
    if (builtIn.ok && compareVersions(version, builtIn.manifest.version) <= 0) break;
    const dir = join(bundlesDir, version);
    const result = verifyBundle(dir, publicKey);
    if (!result.ok || result.manifest.version !== version) {
      state.bad.push(version);
      continue;
    }
    if (result.manifest.shellMin > shellVersion) continue;
    if (state.current !== version) state.pending = version;
    choice = { dir, version, source: 'downloaded', manifest: result.manifest, rolledBackFrom: state.rolledBackFrom };
    break;
  }
  if (!choice && builtIn.ok) {
    choice = { dir: builtInDir, version: builtIn.manifest.version, source: 'builtin', manifest: builtIn.manifest, rolledBackFrom: state.rolledBackFrom };
  }
  writeState(bundlesDir, state);
  return choice;
}

/**
 * The running bundle proved healthy: make it current, keep the one before as previous, and
 * delete every other bundle except downloaded ones newer than it (an update waiting to apply).
 */
export function markHealthy(bundlesDir: string, version: string): void {
  const state = readState(bundlesDir);
  if (state.pending === version) state.pending = undefined;
  if (state.current !== version) {
    state.previous = state.current;
    state.current = version;
  }
  writeState(bundlesDir, state);
  for (const other of downloadedVersions(bundlesDir)) {
    const waiting = compareVersions(other, version) > 0 && !state.bad.includes(other);
    if (other === state.current || other === state.previous || waiting) continue;
    rmSync(join(bundlesDir, other), { recursive: true, force: true });
  }
}

export function clearRollbackNotice(bundlesDir: string): void {
  const state = readState(bundlesDir);
  if (state.rolledBackFrom === undefined) return;
  state.rolledBackFrom = undefined;
  writeState(bundlesDir, state);
}

/**
 * For the terminal `giga`: the bundle the app last ran healthily, else the built-in one.
 * Read-only, so running `giga` never changes what the app will start.
 */
export function currentBundleDir(options: ChooseOptions): string | undefined {
  const { bundlesDir, builtInDir, shellVersion, publicKey } = options;
  const { current } = readState(bundlesDir);
  const builtIn = verifyBundle(builtInDir, publicKey);
  if (current && (!builtIn.ok || compareVersions(current, builtIn.manifest.version) > 0)) {
    const dir = join(bundlesDir, current);
    const result = verifyBundle(dir, publicKey);
    if (result.ok && result.manifest.shellMin <= shellVersion) return dir;
  }
  return builtIn.ok ? builtInDir : undefined;
}
