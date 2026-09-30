import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { compareVersions, verifyBundle, verifyBytes } from '../shared/bundle.js';
import type { UpdateState } from '../shared/types.js';

const run = promisify(execFile);

export const DEFAULT_MANIFEST_URL = 'https://downloads.gigacad.site/desktop/stable/manifest.json';

/**
 * Each system reads its own manifest. The code bundle is the same JavaScript on both, but the
 * manifest also names the full-app download (dmgUrl: the DMG on macOS, the installer on
 * Windows). Its signed fields can't change without breaking installed apps, so Windows gets a
 * second file rather than a new field.
 */
export function defaultManifestUrl(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'https://downloads.gigacad.site/desktop/stable/win32/manifest.json' : DEFAULT_MANIFEST_URL;
}

/** tar ships with macOS and with Windows 10 1803 and later; neither needs anything installed. */
export function tarPath(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  return platform === 'win32' ? `${env.SystemRoot ?? 'C:\\Windows'}\\System32\\tar.exe` : '/usr/bin/tar';
}
const CHECK_INTERVAL = 6 * 60 * 60_000;
const FOCUS_INTERVAL = 60 * 60_000;

/** `manifest.json`: the newest bundle, signed with the same key as the bundles. */
export interface UpdateManifest {
  readonly version: string;
  readonly shellMin: number;
  readonly bundleUrl: string;
  readonly sha256: string;
  readonly size: number;
  readonly notes: string;
  readonly notesUrl: string | null;
  /** The full app to download when the update needs a newer shell: the DMG, or the Windows installer in the Windows manifest. */
  readonly dmgUrl: string;
  readonly publishedAt: string;
  readonly signature: string;
}

const SIGNED_FIELDS = ['version', 'shellMin', 'bundleUrl', 'sha256', 'size', 'notes', 'notesUrl', 'dmgUrl', 'publishedAt'] as const;

/** The exact bytes the signature covers: the fields in a fixed order, as JSON. */
export function canonicalManifest(manifest: Omit<UpdateManifest, 'signature'>): string {
  return JSON.stringify(SIGNED_FIELDS.map((field) => [field, manifest[field]]));
}

export function verifyManifest(manifest: UpdateManifest, publicKey: string): boolean {
  if (typeof manifest.signature !== 'string') return false;
  return verifyBytes(canonicalManifest(manifest), manifest.signature, publicKey);
}

export interface UpdaterOptions {
  readonly currentVersion: string;
  readonly shellVersion: number;
  readonly bundlesDir: string;
  readonly publicKey: string;
  readonly manifestUrl: string;
  readonly fetch?: typeof fetch;
  /** Whether it's safe to restart now (no sync work running). */
  readonly canRestart: () => boolean;
  readonly relaunch: () => void;
  readonly onChange: (state: UpdateState) => void;
}

/**
 * Checks for a newer code bundle, downloads and verifies it in the background, and says when a
 * restart will apply it. Never touches the installed app; the bootstrap picks the bundle up.
 */
export class Updater {
  state: UpdateState = { kind: 'idle', lastChecked: null };
  private checking: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private lastCheckAt = 0;

  constructor(private readonly options: UpdaterOptions) {}

  private set(state: UpdateState): void {
    this.state = state;
    this.options.onChange(state);
  }

  start(firstDelay = 10_000): void {
    this.timer = setTimeout(() => {
      void this.check();
      this.timer = setInterval(() => void this.check(), CHECK_INTERVAL);
    }, firstDelay);
  }

  stop(): void {
    clearTimeout(this.timer);
    clearInterval(this.timer);
  }

  /** When the window gains focus: check again if the last check was over an hour ago. */
  focused(): void {
    if (Date.now() - this.lastCheckAt > FOCUS_INTERVAL) void this.check();
  }

  check(): Promise<void> {
    if (this.state.kind === 'ready' || this.state.kind === 'downloading') return Promise.resolve();
    this.checking ??= this.checkOnce().finally(() => (this.checking = undefined));
    return this.checking;
  }

  private async checkOnce(): Promise<void> {
    const { currentVersion, shellVersion, bundlesDir, publicKey } = this.options;
    const fetchImpl = this.options.fetch ?? fetch;
    this.lastCheckAt = Date.now();
    const lastChecked = new Date().toISOString();
    this.set({ kind: 'checking', lastChecked: this.state.lastChecked });
    try {
      const response = await fetchImpl(this.options.manifestUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`The update server answered HTTP ${response.status}`);
      const manifest = (await response.json()) as UpdateManifest;
      if (!verifyManifest(manifest, publicKey)) throw new Error('The update information isn’t signed by GigaCAD');
      if (compareVersions(manifest.version, currentVersion) <= 0) {
        this.set({ kind: 'idle', lastChecked });
        return;
      }
      if (manifest.shellMin > shellVersion) {
        this.set({ kind: 'needsReinstall', version: manifest.version, notes: manifest.notes, downloadUrl: manifest.dmgUrl, lastChecked });
        return;
      }
      const target = join(bundlesDir, manifest.version);
      if (!existsSync(target) || !verifyBundle(target, publicKey).ok) await this.download(manifest, target, lastChecked);
      this.set({ kind: 'ready', version: manifest.version, notes: manifest.notes, notesUrl: manifest.notesUrl, restarting: false, lastChecked });
    } catch (error) {
      this.set({ kind: 'error', message: error instanceof Error ? error.message : String(error), lastChecked });
    }
  }

  private async download(manifest: UpdateManifest, target: string, lastChecked: string): Promise<void> {
    const { bundlesDir, publicKey, shellVersion } = this.options;
    const fetchImpl = this.options.fetch ?? fetch;
    await mkdir(bundlesDir, { recursive: true, mode: 0o700 });
    const archive = join(bundlesDir, `.download-${manifest.version}.tar.gz`);
    const staging = join(bundlesDir, `.extract-${manifest.version}`);
    try {
      this.set({ kind: 'downloading', version: manifest.version, progress: 0, lastChecked });
      const response = await fetchImpl(manifest.bundleUrl);
      if (!response.ok || !response.body) throw new Error(`Downloading the update failed (HTTP ${response.status})`);
      // Read the body as fast as it arrives, into memory (bundles are about a megabyte). Piping it
      // into a file lets backpressure pause the stream, and undici then asserts when the server
      // closes the connection mid-pause, crashing the main process.
      const hash = createHash('sha256');
      const chunks: Uint8Array[] = [];
      let received = 0;
      let reported = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        chunks.push(value);
        received += value.length;
        if (received > manifest.size) throw new Error('The update download was damaged; it will be tried again later');
        const progress = Math.min(1, received / Math.max(manifest.size, 1));
        if (progress - reported >= 0.01) {
          reported = progress;
          this.set({ kind: 'downloading', version: manifest.version, progress, lastChecked });
        }
      }
      if (received !== manifest.size || hash.digest('hex') !== manifest.sha256) throw new Error('The update download was damaged; it will be tried again later');
      await writeFile(archive, Buffer.concat(chunks));

      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      await run(tarPath(), ['-xzf', archive, '-C', staging]);
      const verified = verifyBundle(staging, publicKey);
      if (!verified.ok) throw new Error(`The update didn’t verify (${verified.reason})`);
      if (verified.manifest.version !== manifest.version || verified.manifest.shellMin > shellVersion) throw new Error('The update doesn’t match its description');
      await rm(target, { recursive: true, force: true });
      await rename(staging, target);
    } finally {
      await rm(archive, { force: true });
      await rm(staging, { recursive: true, force: true });
    }
  }

  /** Restarts into the downloaded bundle once no upload or autosave is running. */
  async restart(pollMs = 500): Promise<void> {
    if (this.state.kind !== 'ready') return;
    this.set({ ...this.state, restarting: true });
    while (!this.options.canRestart()) await new Promise((resolve) => setTimeout(resolve, pollMs));
    this.options.relaunch();
  }
}
