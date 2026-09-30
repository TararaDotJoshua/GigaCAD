import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { supportDir } from '../shared/runtime.js';
import type { ReleasesToKeep, Settings } from '../shared/types.js';

const FILE = () => join(supportDir(), 'settings.json');

export const DEFAULT_SETTINGS: Settings = {
  folder: join(homedir(), 'GigaCAD'),
  apiUrl: 'https://api.gigacad.site',
  appUrl: 'https://app.gigacad.site',
  startAtLogin: true,
  paused: false,
  releases: {},
  branches: {},
  hiddenProjects: [],
  setupDone: false,
  dismissedUpdate: null,
};

export async function loadSettings(): Promise<Settings> {
  try {
    const saved = JSON.parse(await readFile(FILE(), 'utf8')) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(supportDir(), { recursive: true, mode: 0o700 });
  const temp = `${FILE()}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`);
  await rename(temp, FILE());
}

export const releasesToKeep = (settings: Settings, projectId: string): ReleasesToKeep => settings.releases[projectId] ?? 'latest';
