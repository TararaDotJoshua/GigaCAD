import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, Notification, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BundleRuntime } from '../shared/runtime.js';
import { supportDir } from '../shared/runtime.js';
import type { AppState, Commands, Settings, UpdateState } from '../shared/types.js';
import { apiClient } from './api.js';
import { SignIn } from './auth.js';
import { giga } from './cli.js';
import { installCli, isOurShim, SHIM_PATH, terminalGiga } from './cliInstall.js';
import { applyIcons } from './icons.js';
import { locate, projectDir, treeUrl, webUrlFor } from './layout.js';
import { parseActionUrl, type QuickAction } from './quickActions.js';
import { loadSettings, saveSettings } from './settings.js';
import { Setup } from './setup.js';
import { describe, SyncEngine } from './sync.js';
import { DEFAULT_MANIFEST_URL, Updater } from './updates.js';

declare const __GIGACAD_VERSION__: string;

const FOREST = '#0A2922';

/** The app: owns the settings, the sync engine, sign-in, the updater, the window, and the menu bar item. */
export class Controller {
  private settings!: Settings;
  private engine!: SyncEngine;
  private signIn!: SignIn;
  private setup!: Setup;
  private updater!: Updater;
  private window: BrowserWindow | undefined;
  private tray: Tray | undefined;
  private cliPath: string | null = null;
  private stateTimer: NodeJS.Timeout | undefined;
  private healthyTimer: NodeJS.Timeout | undefined;
  private rolledBackFrom: string | null;

  private constructor(private readonly runtime: BundleRuntime) {
    this.rolledBackFrom = runtime.rolledBackFrom ?? null;
  }

  static async create(runtime: BundleRuntime): Promise<Controller> {
    const controller = new Controller(runtime);
    await controller.init();
    return controller;
  }

  private async init(): Promise<void> {
    this.settings = await loadSettings();
    const iconsDir = join(this.runtime.dir, 'icons');
    const iconCacheDir = join(supportDir(), 'icon-cache');
    this.engine = new SyncEngine({
      settings: () => this.settings,
      updateSettings: (change) => this.updateSettings(change),
      iconsDir,
      iconCacheDir,
      changed: () => this.changed(),
    });
    this.signIn = new SignIn(() => this.changed(), (url) => shell.openExternal(url));
    this.setup = new Setup({
      version: __GIGACAD_VERSION__,
      folder: () => this.settings.folder,
      signedIn: () => this.engine.user !== null,
      startAtLogin: () => this.settings.startAtLogin,
      iconFolder: async () => void (await applyIcons([{ target: this.settings.folder, key: 'folder-root' }], iconsDir, iconCacheDir)),
    });
    this.updater = new Updater({
      currentVersion: this.runtime.version,
      shellVersion: this.runtime.shellVersion,
      bundlesDir: this.runtime.bundlesDir,
      publicKey: this.runtime.publicKey,
      manifestUrl: process.env.GIGACAD_UPDATE_URL ?? DEFAULT_MANIFEST_URL,
      canRestart: () => this.engine.idle(),
      relaunch: () => {
        app.relaunch();
        app.exit(0);
      },
      onChange: (state) => this.onUpdateState(state),
    });

    this.buildAppMenu();
    this.createTray();
    await this.setup.repair();
    app.setLoginItemSettings({ openAtLogin: this.settings.startAtLogin });
    const signedIn = await this.engine.start();
    this.cliPath = isOurShim(SHIM_PATH) ? SHIM_PATH : await terminalGiga();
    void this.setup.check().then(() => this.changed());

    if (!this.settings.setupDone || !signedIn) this.showWindow();
    this.updater.start();

    // The bundle is healthy once the window has loaded and syncing has started, or after 20 s without a crash.
    this.healthyTimer = setTimeout(() => this.runtime.markHealthy(), 20_000);
    app.on('will-quit', () => this.runtime.markHealthy());
  }

  // --- State ---------------------------------------------------------------------------------

  state(): AppState {
    return {
      user: this.engine.user ? { handle: this.engine.user.handle, apiUrl: this.settings.apiUrl } : null,
      signIn: this.signIn.pending,
      settings: this.settings,
      sync: this.engine.syncState(),
      projects: this.engine.projectStates(),
      activity: this.engine.activity,
      setup: this.setup.list(),
      updates: this.updater.state,
      rolledBackFrom: this.rolledBackFrom,
      app: { version: this.runtime.version, shellVersion: this.runtime.shellVersion, source: this.runtime.source, cliInstalled: this.cliPath },
    };
  }

  /** Coalesces state changes into one push to the window and one menu bar refresh. */
  private changed(): void {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = undefined;
      const state = this.state();
      this.window?.webContents.send('gigacad:state', state);
      this.updateTray(state);
    }, 100);
  }

  private async updateSettings(change: (settings: Settings) => Settings): Promise<void> {
    this.settings = change(this.settings);
    await saveSettings(this.settings);
    this.changed();
  }

  private onUpdateState(state: UpdateState): void {
    this.changed();
    if (state.kind === 'ready' && this.settings.dismissedUpdate !== state.version && Notification.isSupported() && !this.window?.isVisible()) {
      new Notification({ title: 'GigaCAD update ready', body: `Version ${state.version} applies the next time GigaCAD starts.` }).show();
    }
  }

  // --- Window ----------------------------------------------------------------------------------

  showWindow(focus?: { projectId?: string; branch?: string; commit?: boolean }): void {
    if (!this.window) {
      this.window = new BrowserWindow({
        width: 1120,
        height: 740,
        minWidth: 860,
        minHeight: 560,
        title: 'GigaCAD',
        titleBarStyle: 'hiddenInset',
        backgroundColor: FOREST,
        show: false,
        webPreferences: {
          preload: join(this.runtime.dir, 'preload', 'index.cjs'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      const devUrl = process.env.GIGACAD_RENDERER_URL;
      if (devUrl && !app.isPackaged) void this.window.loadURL(devUrl);
      else void this.window.loadFile(join(this.runtime.dir, 'renderer', 'index.html'));
      this.window.once('ready-to-show', () => this.window?.show());
      // In development, the window's console goes to the terminal running `pnpm dev`.
      if (!app.isPackaged) {
        this.window.webContents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
          if (level !== 'debug') console.log(`[window ${level}] ${message} (${sourceId}:${lineNumber})`);
        });
      }
      this.window.webContents.once('did-finish-load', () => {
        if (this.engine.user) this.runtime.markHealthy();
      });
      this.window.on('focus', () => {
        this.updater.focused();
        void this.engine.poll();
      });
      // Links open in the browser, never inside the app.
      this.window.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: 'deny' };
      });
      this.window.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file:') && !(devUrl && url.startsWith(devUrl))) {
          event.preventDefault();
          void shell.openExternal(url);
        }
      });
      this.window.on('closed', () => {
        this.window = undefined;
        app.dock?.hide();
      });
    }
    void app.dock?.show();
    if (this.window.isVisible()) this.window.show();
    this.window.focus();
    app.focus({ steal: true });
    if (focus) {
      const send = () => this.window?.webContents.send('gigacad:navigate', focus);
      if (this.window.webContents.isLoading()) this.window.webContents.once('did-finish-load', send);
      else send();
    }
  }

  // --- Menu bar item ---------------------------------------------------------------------------

  private createTray(): void {
    const image = nativeImage.createFromPath(join(this.runtime.dir, 'icons', 'trayTemplate.png'));
    image.setTemplateImage(true);
    this.tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    if (image.isEmpty()) this.tray.setTitle('GigaCAD');
    this.tray.setToolTip('GigaCAD');
    this.updateTray(this.state());
  }

  private updateTray(state: AppState): void {
    if (!this.tray) return;
    const { sync, updates } = state;
    const status =
      sync.status === 'signed-out'
        ? 'Signed out'
        : sync.status === 'paused'
          ? 'Syncing paused'
          : sync.status === 'syncing'
            ? `Syncing ${sync.active} ${sync.active === 1 ? 'task' : 'tasks'}…`
            : sync.status === 'offline'
              ? 'Offline: will retry'
              : sync.status === 'error'
                ? 'Sync problem: open GigaCAD'
                : 'Up to date';
    const items: MenuItemConstructorOptions[] = [
      { label: status, enabled: false },
      ...state.activity.slice(0, 3).map((item) => ({ label: truncate(item.text, 60), enabled: false })),
      { type: 'separator' },
    ];
    if (updates.kind === 'ready') items.push({ label: `Restart to Update to ${updates.version}`, click: () => void this.updater.restart() }, { type: 'separator' });
    items.push(
      { label: 'Open GigaCAD Folder', click: () => void shell.openPath(this.settings.folder) },
      { label: 'Open GigaCAD', click: () => this.showWindow() },
      { label: 'Sync Now', enabled: state.user !== null && !this.settings.paused, click: () => void this.engine.syncAll() },
      { label: this.settings.paused ? 'Resume Syncing' : 'Pause Syncing', enabled: state.user !== null, click: () => void this.run('setPaused', [!this.settings.paused]) },
      { type: 'separator' },
      { label: 'Check for Updates…', click: () => void this.updater.check() },
      { label: 'Quit GigaCAD', role: 'quit' },
    );
    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  private buildAppMenu(): void {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'GigaCAD',
          submenu: [
            { role: 'about' },
            { label: 'Check for Updates…', click: () => void this.updater.check() },
            { type: 'separator' },
            { label: 'Settings…', accelerator: 'Command+,', click: () => this.showWindow({ projectId: 'settings' }) },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        { role: 'editMenu' },
        { role: 'windowMenu' },
      ]),
    );
  }

  // --- Commands from the window ------------------------------------------------------------------

  /** Runs one command from the window. The window gets errors as data, with giga's hint. */
  async run(name: keyof Commands, args: unknown[]): Promise<unknown> {
    const handler = (this.commands as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
    if (!handler) throw new Error(`Unknown command ${name}`);
    return handler(...args);
  }

  private readonly commands: Commands = {
    getState: () => this.state(),
    signIn: () => {
      void this.signIn
        .start(this.settings.apiUrl)
        .then(async (done) => {
          if (!done) return;
          await this.engine.start();
          this.setup.setStatus('signin', 'done');
          this.changed();
        })
        .catch((error: unknown) => this.log(`Sign-in didn’t finish: ${describe(error)}`));
    },
    cancelSignIn: () => this.signIn.cancel(),
    signOut: async () => {
      await this.signIn.signOut(this.settings.apiUrl);
      this.engine.stop();
      await this.engine.start();
      this.setup.setStatus('signin', 'todo');
    },
    syncNow: () => void this.engine.syncAll(),
    setPaused: async (paused) => {
      await this.updateSettings((settings) => ({ ...settings, paused }));
      if (!paused) void this.engine.syncAll();
    },
    updateSettings: async (change) => {
      await this.updateSettings((settings) => ({ ...settings, ...change }));
      if (change.startAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin: change.startAtLogin });
      if (change.folder !== undefined) await this.engine.start();
    },
    chooseFolder: async () => {
      const result = await dialog.showOpenDialog({
        title: 'Choose the GigaCAD folder',
        message: 'Projects will be downloaded into this folder. The current folder stays where it is.',
        defaultPath: this.settings.folder,
        properties: ['openDirectory', 'createDirectory'],
      });
      const folder = result.filePaths[0];
      if (result.canceled || !folder || folder === this.settings.folder) return;
      await this.updateSettings((settings) => ({ ...settings, folder }));
      await this.setup.repair();
      await this.engine.start();
    },
    setReleasesToKeep: async (projectId, keep) => {
      await this.updateSettings((settings) => ({ ...settings, releases: { ...settings.releases, [projectId]: keep } }));
      void this.engine.syncProject(projectId);
    },
    setProjectHidden: async (projectId, hidden) => {
      await this.updateSettings((settings) => ({
        ...settings,
        hiddenProjects: hidden ? [...new Set([...settings.hiddenProjects, projectId])] : settings.hiddenProjects.filter((id) => id !== projectId),
      }));
      if (!hidden) void this.engine.syncProject(projectId);
    },

    checkout: (projectId, branch) => this.engine.checkout(projectId, branch),
    checkin: (projectId, branch) => this.engine.checkin(projectId, branch),
    commitVersion: (projectId, branch, message, label) => this.engine.commitVersion(projectId, branch, message, label),
    pull: (projectId, branch) => this.engine.pull(projectId, branch),
    downloadBranch: (projectId, branch) => this.engine.downloadBranch(projectId, branch),
    removeBranch: (projectId, branch) => this.engine.removeBranch(projectId, branch),
    downloadRelease: (projectId, number) => this.engine.downloadRelease(projectId, number),
    createBranch: async (projectId, name, fromRelease) => {
      const project = this.project(projectId);
      await giga(['branch', 'create', name, '--project', `${project.owner}/${project.slug}`, ...(fromRelease ? ['--from-release', String(fromRelease)] : [])], this.opts());
      await this.engine.downloadBranch(projectId, name).catch(() => this.engine.syncProject(projectId));
      await this.engine.syncProject(projectId);
    },

    branchStatus: (projectId, branch) => giga(['status'], this.opts(this.branchPath(projectId, branch))),
    branchHistory: async (projectId, branch) => {
      const id = this.project(projectId).branches.find((candidate) => candidate.name === branch)?.id;
      return (await apiClient(this.settings.apiUrl)).get(`/v1/branches/${id}/commits`);
    },
    releaseRequests: async (projectId) => (await apiClient(this.settings.apiUrl)).get(`/v1/projects/${projectId}/release-requests`),
    openReleaseRequest: (projectId, branch, title, body) => {
      const project = this.project(projectId);
      return giga(['rr', 'open', '--project', `${project.owner}/${project.slug}`, '--branch', branch, ...(title ? ['--title', title] : []), ...(body ? ['--body', body] : [])], this.opts());
    },
    approveReleaseRequest: async (projectId, number) => {
      const project = this.project(projectId);
      await giga(['rr', 'approve', String(number), '--project', `${project.owner}/${project.slug}`], this.opts());
    },

    reveal: (path) => shell.showItemInFolder(path),
    openExternal: (url) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
    },
    openTerminal: (path) => void execFile('/usr/bin/open', ['-a', 'Terminal', path]),
    webUrl: (projectId, path) => {
      const project = this.project(projectId);
      return treeUrl(this.settings.appUrl, project.owner, project.slug, path);
    },

    runSetup: async () => {
      await this.setup.runAll();
      this.changed();
    },
    finishSetup: async () => {
      await this.updateSettings((settings) => ({ ...settings, setupDone: true }));
    },
    moveToApplications: () => {
      if (!this.setup.moveToApplications()) throw new Error('GigaCAD couldn’t move itself to Applications. Drag it there in Finder instead.');
    },
    installCli: async () => {
      const result = await installCli();
      this.cliPath = result.terminalUses ?? result.path;
      this.setup.setStatus('cli', 'done', result.terminalUses && result.terminalUses !== result.path ? `Installed; Terminal uses ${result.terminalUses} first` : result.path);
      this.changed();
    },

    checkForUpdates: () => void this.updater.check(),
    restartToUpdate: () => void this.updater.restart(),
    dismissUpdate: async () => {
      const state = this.updater.state;
      if (state.kind === 'ready' || state.kind === 'needsReinstall') await this.updateSettings((settings) => ({ ...settings, dismissedUpdate: state.version }));
    },
    dismissRollback: () => {
      this.runtime.clearRollbackNotice();
      this.rolledBackFrom = null;
      this.changed();
    },
  };

  private opts(cwd = this.settings.folder) {
    return { cwd, apiUrl: this.settings.apiUrl };
  }

  private project(projectId: string) {
    const project = this.engine.projectStates().find((candidate) => candidate.id === projectId);
    if (!project) throw new Error('That project isn’t synced to this Mac');
    return project;
  }

  private branchPath(projectId: string, branch: string): string {
    const project = this.project(projectId);
    return join(projectDir(this.settings.folder, project.owner, project.slug), 'Branches', branch);
  }

  /** Adds an error to the activity list (the window and the menu bar show it). */
  log(text: string): void {
    this.engine.activity.unshift({ at: new Date().toISOString(), text, kind: 'error' });
    this.changed();
  }

  // --- Quick Actions (gigacad:// links from Finder) ----------------------------------------------

  async handleUrl(url: string): Promise<void> {
    const parsed = parseActionUrl(url);
    if (!parsed) return;
    try {
      await this.handleAction(parsed.action, parsed.path);
    } catch (error) {
      this.tell('GigaCAD couldn’t do that', describe(error));
    }
  }

  private async handleAction(action: QuickAction, path: string): Promise<void> {
    const location = locate(this.settings.folder, path);
    const project = location?.owner
      ? this.engine.projectStates().find((candidate) => candidate.owner === location.owner && candidate.slug === location.project)
      : undefined;
    if (action === 'show') {
      this.showWindow({ projectId: project?.id, branch: location?.area === 'branch' ? location.name : undefined });
      return;
    }
    if (!location || !project) {
      this.tell('Not in the GigaCAD folder', `GigaCAD actions work on files and folders inside ${this.settings.folder}.`);
      return;
    }
    const isFile = await stat(path).then((info) => !info.isDirectory(), () => true);
    const url = webUrlFor(this.settings.appUrl, location, isFile);

    if (action === 'copy-link' && url) {
      clipboard.writeText(url);
      this.notify('Link copied', url);
      return;
    }
    if (action === 'open-web' && url) {
      void shell.openExternal(url);
      return;
    }
    if (action === 'download') {
      if (location.area === 'branch' && location.name) await this.engine.downloadBranch(project.id, location.name);
      else if (location.area === 'release' && location.releaseNumber) await this.engine.downloadRelease(project.id, location.releaseNumber);
      else this.tell('Nothing to download', 'Choose a branch or release folder that isn’t downloaded yet.');
      return;
    }

    // Check out, check in, commit, and pull work on branches.
    if (location.area === 'release' || location.area === 'releases') {
      this.tell('Releases are read-only', 'Releases are permanent. To change one, create a branch from it in GigaCAD.');
      return;
    }
    if (location.area !== 'branch' || !location.name) {
      this.tell(
        location.area === 'project-root' ? 'Root files don’t need a checkout' : 'Choose a branch folder',
        location.area === 'project-root' ? 'Files at the project root sync on their own; each save records a new revision.' : 'Check out, check in, and commit work on the folders inside Branches.',
      );
      return;
    }
    const branch = location.name;
    if (action === 'checkout') {
      await this.engine.checkout(project.id, branch);
      this.notify(`Checked out ${branch}`, 'Its files are now editable on this Mac.');
    } else if (action === 'checkin') {
      await this.engine.checkin(project.id, branch);
      this.notify(`Checked in ${branch}`, 'Others can check it out now.');
    } else if (action === 'pull') {
      await this.engine.pull(project.id, branch);
      this.notify(`${branch} is up to date`, `${project.owner}/${project.slug}`);
    } else if (action === 'commit') {
      this.showWindow({ projectId: project.id, branch, commit: true });
    }
  }

  private notify(title: string, body: string): void {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  }

  private tell(title: string, message: string): void {
    void dialog.showMessageBox({ type: 'info', title: 'GigaCAD', message: title, detail: message, buttons: ['OK'] });
  }
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
