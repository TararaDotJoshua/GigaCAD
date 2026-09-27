import { app } from 'electron';
import { mkdir } from 'node:fs/promises';
import type { SetupStep, SetupStepId } from '../shared/types.js';
import { appBundlePath, isOurShim, SHIM_PATH, terminalGiga } from './cliInstall.js';
import { installQuickActions, quickActionsInstalled } from './quickActions.js';

export interface SetupHost {
  readonly version: string;
  folder(): string;
  signedIn(): boolean;
  startAtLogin(): boolean;
  /** Gives the GigaCAD folder its icon. */
  iconFolder(): Promise<void>;
}

type Status = SetupStep['status'];

const TITLES: Record<SetupStepId, string> = {
  applications: 'Move GigaCAD to Applications',
  signin: 'Sign in to GigaCAD',
  folder: 'Create the GigaCAD folder',
  quickActions: 'Add GigaCAD to Finder’s right-click menu',
  urlScheme: 'Open gigacad:// links in GigaCAD',
  cli: 'Install the giga command line tool',
  login: 'Start GigaCAD when you log in',
};
const OPTIONAL = new Set<SetupStepId>(['cli', 'applications']);

/**
 * The first-run checklist, also run as "Repair" from Settings. Every step is idempotent, and
 * steps 3–5 (folder, Quick Actions, gigacad:// links) are re-checked quietly on every launch.
 */
export class Setup {
  private readonly steps = new Map<SetupStepId, { status: Status; detail: string | null }>();

  constructor(private readonly host: SetupHost) {
    for (const id of Object.keys(TITLES) as SetupStepId[]) this.steps.set(id, { status: 'todo', detail: null });
  }

  list(): SetupStep[] {
    return [...this.steps].map(([id, step]) => ({ id, title: TITLES[id], optional: OPTIONAL.has(id), ...step }));
  }

  private mark(id: SetupStepId, status: Status, detail: string | null = null): void {
    this.steps.set(id, { status, detail });
  }

  private async step(id: SetupStepId, work: () => Promise<[Status, string | null] | Status>): Promise<void> {
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
      if (!quickActionsInstalled(this.host.version)) await installQuickActions(this.host.version);
      return 'done';
    });
    await this.step('urlScheme', async () => (app.setAsDefaultProtocolClient('gigacad') || app.isDefaultProtocolClient('gigacad') ? 'done' : 'error'));
  }

  /** The whole checklist. Moving to Applications relaunches the app, so it's offered, not forced. */
  async runAll(): Promise<void> {
    await this.step('applications', async () => {
      if (!app.isPackaged) return ['skipped', 'Development build'];
      if (app.isInApplicationsFolder()) return 'done';
      return ['todo', 'GigaCAD isn’t in Applications. Moving it there keeps gigacad:// links and the giga tool working.'];
    });
    await this.step('signin', async () => (this.host.signedIn() ? 'done' : 'todo'));
    await this.repair();
    await this.step('cli', async () => {
      if (isOurShim(SHIM_PATH)) return ['done', SHIM_PATH];
      if (!appBundlePath()) return ['skipped', 'Only from the installed app'];
      const other = await terminalGiga();
      return other ? ['skipped', `Terminal already has giga at ${other}`] : 'todo';
    });
    await this.step('login', async () => {
      app.setLoginItemSettings({ openAtLogin: this.host.startAtLogin() });
      return this.host.startAtLogin() ? 'done' : ['skipped', 'Off in Settings'];
    });
  }

  /** Moves the app to /Applications and relaunches it (macOS asks first). */
  moveToApplications(): boolean {
    return app.moveToApplicationsFolder();
  }

  setStatus(id: SetupStepId, status: Status, detail: string | null = null): void {
    this.mark(id, status, detail);
  }
}
