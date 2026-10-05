import { app } from 'electron';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { platformWords } from '../shared/platform.js';
import type { SetupStep, SetupStepId } from '../shared/types.js';
import { supportDir } from '../shared/runtime.js';
import { appBundlePath, isOurCmdShim, isOurShim, SHIM_PATH, terminalGiga, windowsShimDir, windowsTerminalGiga } from './cliInstall.js';
import { explorerMenuInstalled, installExplorerMenu } from './explorerMenu.js';
import { installQuickActions, quickActionsInstalled } from './quickActions.js';

export interface SetupHost {
  readonly version: string;
  folder(): string;
  signedIn(): boolean;
  startAtLogin(): boolean;
  /** Gives the GigaCAD folder its icon. */
  iconFolder(): Promise<void>;
  readonly platform?: NodeJS.Platform;
}

type Status = SetupStep['status'];

const titles = (platform: string): Record<SetupStepId, string> => ({
  applications: 'Move GigaCAD to Applications',
  signin: 'Sign in to GigaCAD',
  folder: 'Create the GigaCAD folder',
  quickActions: `Add GigaCAD to ${platformWords(platform).rightClickMenu}`,
  urlScheme: 'Open gigacad:// links in GigaCAD',
  cli: 'Install the giga command line tool',
  login: 'Start GigaCAD when you log in',
});
/** Windows installs apps where they belong, so there's no Applications step. */
const STEPS: Record<string, readonly SetupStepId[]> = {
  win32: ['signin', 'folder', 'quickActions', 'urlScheme', 'cli', 'login'],
  default: ['applications', 'signin', 'folder', 'quickActions', 'urlScheme', 'cli', 'login'],
};
const OPTIONAL = new Set<SetupStepId>(['cli', 'applications']);

/**
 * The first-run checklist, also run as "Repair" from Settings. Every step is idempotent, and
 * steps 3–5 (folder, Quick Actions, gigacad:// links) are re-checked quietly on every launch.
 */
export class Setup {
  private readonly steps = new Map<SetupStepId, { status: Status; detail: string | null }>();
  private readonly platform: NodeJS.Platform;
  private readonly titles: Record<SetupStepId, string>;

  constructor(private readonly host: SetupHost) {
    this.platform = host.platform ?? process.platform;
    this.titles = titles(this.platform);
    for (const id of STEPS[this.platform] ?? STEPS.default!) this.steps.set(id, { status: 'todo', detail: null });
  }

  list(): SetupStep[] {
    return [...this.steps].map(([id, step]) => ({ id, title: this.titles[id], optional: OPTIONAL.has(id), ...step }));
  }

  private mark(id: SetupStepId, status: Status, detail: string | null = null): void {
    if (this.steps.has(id)) this.steps.set(id, { status, detail });
  }

  private async step(id: SetupStepId, work: () => Promise<[Status, string | null] | Status>): Promise<void> {
    if (!this.steps.has(id)) return;
    this.mark(id, 'running');
    try {
      const result = await work();
      const [status, detail] = Array.isArray(result) ? result : [result, null];
      this.mark(id, status, detail);
    } catch (error) {
      this.mark(id, 'error', error instanceof Error ? error.message : String(error));
    }
  }

  /** Quietly repairs the folder, Quick Actions, and the link handler; runs at every launch. */
  async repair(): Promise<void> {
    await this.step('folder', async () => {
      await mkdir(this.host.folder(), { recursive: true });
      await this.host.iconFolder();
      return 'done';
    });
    await this.step('quickActions', async () => {
      if (this.platform === 'win32') {
        // The menu runs GigaCAD.exe; in development that's the stock Electron binary.
        if (!app.isPackaged) return ['skipped', 'Only from the installed app'];
        const menu = { exe: process.execPath, folder: this.host.folder(), version: this.host.version };
        if (!(await explorerMenuInstalled(menu))) await installExplorerMenu(menu);
        return 'done';
      }
      if (!quickActionsInstalled(this.host.version)) await installQuickActions(this.host.version);
      return 'done';
    });
    await this.step('urlScheme', async () => (app.setAsDefaultProtocolClient('gigacad') || app.isDefaultProtocolClient('gigacad') ? 'done' : 'error'));
  }

  /** Checks the steps that only need a look (nothing is changed); runs at every launch too. */
  async check(): Promise<void> {
    await this.step('applications', async () => {
      if (!app.isPackaged) return ['skipped', 'Development build'];
      if (app.isInApplicationsFolder()) return 'done';
      return ['todo', 'GigaCAD isn’t in Applications. Moving it there keeps gigacad:// links and the giga tool working.'];
    });
    await this.step('signin', async () => (this.host.signedIn() ? 'done' : 'todo'));
    await this.step('cli', async () => {
      if (this.platform === 'win32') {
        const shim = join(windowsShimDir(supportDir()), 'giga.cmd');
        if (isOurCmdShim(shim)) return ['done', shim];
        if (!app.isPackaged) return ['skipped', 'Only from the installed app'];
        const other = await windowsTerminalGiga();
        return other ? ['skipped', `The terminal already has giga at ${other}`] : 'todo';
      }
      if (isOurShim(SHIM_PATH)) return ['done', SHIM_PATH];
      if (!appBundlePath()) return ['skipped', 'Only from the installed app'];
      const other = await terminalGiga();
      return other ? ['skipped', `Terminal already has giga at ${other}`] : 'todo';
    });
    await this.step('login', async () => (this.host.startAtLogin() ? 'done' : ['skipped', 'Off in Settings']));
  }

  /** The whole checklist. Moving to Applications (macOS) relaunches the app, so it's offered, not forced. */
  async runAll(): Promise<void> {
    app.setLoginItemSettings({ openAtLogin: this.host.startAtLogin() });
    await this.check();
    await this.repair();
  }

  /** Moves the app to /Applications and relaunches it (macOS asks first). */
  moveToApplications(): boolean {
    return app.moveToApplicationsFolder();
  }

  setStatus(id: SetupStepId, status: Status, detail: string | null = null): void {
    this.mark(id, status, detail);
  }
}
