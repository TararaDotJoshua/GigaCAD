import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, Notification, screen, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { platformWords } from '../shared/platform.js';
import { SHORTCUTS, type ShortcutAction } from '../shared/shortcuts.js';
import { ago } from '../shared/time.js';
import type { BundleRuntime } from '../shared/runtime.js';
import { supportDir } from '../shared/runtime.js';
import type { AppState, Approval, Commands, PluginState, Settings, UpdateState } from '../shared/types.js';
import { apiClient } from './api.js';
import { branchSignatures, changedFolders, registerAddInMethods } from './addInMethods.js';
import { SignIn } from './auth.js';
import { giga } from './cli.js';
import { installCli, installWindowsCli, isOurCmdShim, isOurShim, SHIM_PATH, terminalGiga, windowsShimDir, windowsTerminalGiga } from './cliInstall.js';
import { applyIcons } from './icons.js';
import { locate, projectDir, treeUrl, webUrlFor } from './layout.js';
import { createPluginHost, type PluginHost } from './plugins/index.js';
import { METHODS } from './plugins/protocol.js';
import { parseActionUrl, type QuickAction } from './quickActions.js';
import { loadSettings, saveSettings } from './settings.js';
import { Setup } from './setup.js';
import { restorableBounds } from './windowState.js';
import { needsYouCount, notices, pauseEnd, snapshot, type Snapshot } from './attention.js';
import type { TrayState } from './iconArt.js';
import { describe, SyncEngine } from './sync.js';
import { defaultManifestUrl, Updater } from './updates.js';

declare const __GIGACAD_VERSION__: string;

const FOREST = '#0A2922';
const PAPER = '#F5F5F7';
const isWindows = process.platform === 'win32';
const words = platformWords(process.platform);

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
  private plugins!: PluginHost;
  private installations = new Map<string, PluginState['installations']>();
  /** Branch folder states last announced to CAD add-ins. */
  private announced = new Map<string, string>();
  /** Release requests waiting for this person's approval, polled from the API. */
  private approvals: Approval[] = [];
  private approvalsTimer: NodeJS.Timeout | undefined;
  /** What the last notifications were worked out from. */
  private attention: Snapshot | null = null;
  /** When the current sync problem started, and whether it has been notified. */
  private problem: { since: number; told: boolean } | null = null;
  private pauseTimer: NodeJS.Timeout | undefined;
  private readonly trayImages = new Map<string, Electron.NativeImage>();
  private trayKey = '';

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
      manifestUrl: process.env.GIGACAD_UPDATE_URL ?? defaultManifestUrl(),
      canRestart: () => this.engine.idle(),
      relaunch: () => {
        app.relaunch();
        app.exit(0);
      },
      onChange: (state) => this.onUpdateState(state),
    });

    this.plugins = createPluginHost({
      hostVersion: this.runtime.version,
      signedInAs: () => this.engine.user?.handle ?? null,
      log: (level, message, error) => (level === 'info' ? console.log : console.error)(`GigaCAD plugins: ${message}`, ...(error ? [error] : [])),
      onSessionsChanged: () => this.changed(),
    });
    registerAddInMethods(this.plugins.server, {
      folder: () => this.settings.folder,
      user: () => this.engine.user,
      projects: () => this.engine.projectStates(),
      checkout: (projectId, branch) => this.engine.checkout(projectId, branch),
      checkin: (projectId, branch) => this.engine.checkin(projectId, branch),
      commitVersion: (projectId, branch, message, label) => this.engine.commitVersion(projectId, branch, message, label),
      giga: (args, cwd) => giga(args, this.opts(cwd)),
      put: async (path, body) => (await apiClient(this.settings.apiUrl)).put(path, body),
    });
    // CAD add-ins (SolidWorks) run on Windows only; the pipe isn't opened elsewhere.
    if (isWindows) void this.plugins.server.listen().catch((error: unknown) => this.log(`CAD add-ins can’t connect: ${describe(error)}`));
    void this.refreshInstallations();

    this.buildAppMenu();
    this.createTray();
    await this.setup.repair();
    app.setLoginItemSettings({ openAtLogin: this.settings.startAtLogin });
    const signedIn = await this.engine.start();
    this.cliPath = await this.findCli();
    void this.setup.check().then(() => this.changed());

    if (!this.settings.setupDone || !signedIn) this.showWindow();
    this.updater.start();
    this.schedulePauseEnd();
    void this.pollApprovals();
    // A sync problem is only worth a notification once it has lasted 5 minutes.
    setInterval(() => this.updateAttention(this.state()), 60_000).unref();

    // The bundle is healthy once the window has loaded and syncing has started, or after 20 s without a crash.
    this.healthyTimer = setTimeout(() => this.runtime.markHealthy(), 20_000);
    app.on('will-quit', () => {
      this.runtime.markHealthy();
      void this.plugins.server.close();
    });
  }

  /** Tells connected CAD add-ins which branch folders changed (checkouts, new versions, downloads). */
  private announceToAddIns(state: AppState): void {
    const now = branchSignatures(state.projects);
    const changed = changedFolders(this.announced, now);
    this.announced = now;
    if (changed.length > 0 && this.plugins.server.sessions.length > 0) this.plugins.server.broadcast(METHODS.stateChanged, { paths: changed });
  }

  /** The giga a new terminal runs: GigaCAD's own shim when it's installed, else whatever is on PATH. */
  private async findCli(): Promise<string | null> {
    if (isWindows) {
      const shim = join(windowsShimDir(supportDir()), 'giga.cmd');
      return isOurCmdShim(shim) ? shim : await windowsTerminalGiga();
    }
    return isOurShim(SHIM_PATH) ? SHIM_PATH : await terminalGiga();
  }

  /** Asks each plugin where its CAD program is installed; for the plugin list in Settings. */
  private async refreshInstallations(): Promise<void> {
    const found = await this.plugins.registry.findInstallations();
    this.installations = new Map();
    for (const { pluginId, version, installPath, addInRegistered } of found) {
      this.installations.set(pluginId, [...(this.installations.get(pluginId) ?? []), { version, installPath, addInRegistered }]);
    }
    this.changed();
  }

  private pluginStates(): PluginState[] {
    const sessions = this.plugins?.server.sessions ?? [];
    return (this.plugins?.registry.status ?? []).map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      state: plugin.state,
      error: plugin.error ?? null,
      turnedOff: plugin.turnedOff,
      installations: this.installations.get(plugin.id) ?? [],
      addInsConnected: sessions.filter((session) => session.pluginId === plugin.id).length,
    }));
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
      approvals: this.approvals,
      setup: this.setup.list(),
      updates: this.updater.state,
      rolledBackFrom: this.rolledBackFrom,
      plugins: this.pluginStates(),
      app: { version: this.runtime.version, shellVersion: this.runtime.shellVersion, source: this.runtime.source, cliInstalled: this.cliPath, platform: process.platform },
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
      this.updateAttention(state);
      this.announceToAddIns(state);
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
      const bounds = restorableBounds(this.settings.window, screen.getAllDisplays().map((display) => display.workArea));
      this.window = new BrowserWindow({
        width: 1120,
        height: 740,
        ...bounds,
        minWidth: 860,
        minHeight: 560,
        title: 'GigaCAD',
        // macOS: the traffic lights sit in the sidebar. Windows: the caption buttons are drawn over
        // the toolbar in its own colors, so the window keeps one dark surface.
        ...(isWindows ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: FOREST, symbolColor: PAPER, height: 52 } } : { titleBarStyle: 'hiddenInset' as const }),
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
      this.window.once('ready-to-show', () => {
        if (bounds && this.settings.window?.maximized) this.window?.maximize();
        this.window?.show();
      });
      this.window.webContents.on('did-finish-load', () => this.window?.webContents.setZoomLevel(this.settings.zoom));
      // Remember where the window is, a moment after it stops moving.
      let saveTimer: NodeJS.Timeout | undefined;
      const saveBounds = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          const window = this.window;
          if (!window || window.isMinimized() || window.isFullScreen()) return;
          const { x, y, width, height } = window.getNormalBounds();
          void this.updateSettings((settings) => ({ ...settings, window: { x, y, width, height, maximized: window.isMaximized() } }));
        }, 500);
      };
      for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const) this.window.on(event as 'resize', saveBounds);
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
        void this.pollApprovals();
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
    if (isWindows) {
      // The notification area shows colored icons; a click opens the window, as Windows apps do.
      const image = nativeImage.createFromPath(join(this.runtime.dir, 'icons', 'trayWin.png'));
      this.tray = new Tray(image);
      if (image.isEmpty()) void app.getFileIcon(process.execPath, { size: 'small' }).then((icon) => this.tray?.setImage(icon));
      this.tray.on('click', () => this.showWindow());
    } else {
      const image = nativeImage.createFromPath(join(this.runtime.dir, 'icons', 'trayTemplate.png'));
      image.setTemplateImage(true);
      this.tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
      if (image.isEmpty()) this.tray.setTitle('GigaCAD');
    }
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
    const trayState = sync.status === 'syncing' ? 'syncing' : sync.status === 'error' || sync.status === 'offline' ? 'problem' : sync.status === 'paused' ? 'paused' : 'idle';
    this.setTrayImage(trayState);
    const synced = sync.lastSyncedAt ? `Synced ${ago(sync.lastSyncedAt)}` : 'Not synced yet';
    this.tray.setToolTip(`GigaCAD · ${sync.status === 'idle' ? synced : status}`);
    // The projects most recently worked on, from the activity list.
    const recent = [...new Set(state.activity.map((item) => item.projectId).filter((id): id is string => Boolean(id)))]
      .map((id) => state.projects.find((project) => project.id === id && !project.hidden))
      .filter((project): project is NonNullable<typeof project> => Boolean(project))
      .slice(0, 5);
    const items: MenuItemConstructorOptions[] = [
      { label: status, enabled: false },
      ...state.activity.slice(0, 3).map((item) => ({ label: truncate(item.text, 60), enabled: false })),
      { type: 'separator' },
      ...(recent.length > 0
        ? [
            { label: 'Recent Projects', enabled: false },
            ...recent.map((project): MenuItemConstructorOptions => ({ label: project.name, click: () => this.showWindow({ projectId: project.id }) })),
            { type: 'separator' as const },
          ]
        : []),
    ];
    if (updates.kind === 'ready') items.push({ label: `Restart to Update to ${updates.version}`, click: () => void this.updater.restart() }, { type: 'separator' });
    items.push(
      { label: 'Open GigaCAD Folder', click: () => void shell.openPath(this.settings.folder) },
      { label: 'Open GigaCAD', click: () => this.showWindow() },
      { label: 'Sync Now', enabled: state.user !== null && !this.settings.paused, click: () => void this.engine.syncAll() },
      this.settings.paused
        ? {
            label: this.settings.pausedUntil ? `Resume Syncing (paused until ${new Date(this.settings.pausedUntil).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })})` : 'Resume Syncing',
            enabled: state.user !== null,
            click: () => void this.run('setPaused', [false]),
          }
        : {
            label: 'Pause Syncing',
            enabled: state.user !== null,
            submenu: [
              { label: 'For 1 Hour', click: () => void this.run('setPaused', [true, 'hour']) },
              { label: 'Until Tomorrow', click: () => void this.run('setPaused', [true, 'tomorrow']) },
              { label: 'Until I Resume', click: () => void this.run('setPaused', [true, null]) },
            ],
          },
      { type: 'separator' },
      { label: 'Check for Updates…', click: () => void this.updater.check() },
      { label: 'Quit GigaCAD', role: 'quit' },
    );
    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  private setTrayImage(state: TrayState): void {
    if (!this.tray || this.trayKey === state) return;
    this.trayKey = state;
    const name = `${isWindows ? 'trayWin' : 'trayTemplate'}${state === 'idle' ? '' : `-${state}`}.png`;
    let image = this.trayImages.get(name);
    if (!image) {
      image = nativeImage.createFromPath(join(this.runtime.dir, 'icons', name));
      if (!isWindows) image.setTemplateImage(true);
      this.trayImages.set(name, image);
    }
    // Bundles from before the state icons keep the plain one.
    if (!image.isEmpty()) this.tray.setImage(image);
  }

  // --- Things that need you --------------------------------------------------------------------

  /** Release requests waiting for this person's approval, every two minutes and on focus. */
  private async pollApprovals(): Promise<void> {
    clearTimeout(this.approvalsTimer);
    this.approvalsTimer = setTimeout(() => void this.pollApprovals(), 120_000);
    this.approvalsTimer.unref();
    if (!this.engine.user || this.settings.paused) return;
    const api = await apiClient(this.settings.apiUrl);
    const editable = this.engine.projectStates().filter((project) => !project.hidden && project.role !== null && project.role !== 'viewer');
    const found: Approval[] = [];
    for (const project of editable) {
      const requests = await api.get<{ number: number; title: string; status: string; branchName: string; requesterHandle: string | null }[]>(`/v1/projects/${project.id}/release-requests`).catch(() => []);
      for (const request of requests) {
        // Your own request isn't waiting for you.
        if (request.status === 'candidate' && request.requesterHandle !== this.engine.user?.handle) found.push({ projectId: project.id, number: request.number, title: request.title, branchName: request.branchName });
      }
    }
    if (JSON.stringify(found) !== JSON.stringify(this.approvals)) {
      this.approvals = found;
      this.changed();
    }
  }

  /** System notifications while the window is hidden, and the Dock or taskbar count. */
  private updateAttention(state: AppState): void {
    const next = snapshot(state.projects, state.approvals);
    const hidden = !this.window?.isVisible();
    if (hidden && Notification.isSupported()) {
      for (const notice of notices(this.attention, next, state.projects, state.approvals, this.settings.notify)) this.notify(notice.title, notice.body, { projectId: notice.projectId, branch: notice.branch });
    }
    this.attention = next;

    const troubled = state.sync.status === 'error' || state.sync.status === 'offline';
    if (!troubled) this.problem = null;
    else if (!this.problem) this.problem = { since: Date.now(), told: false };
    else if (!this.problem.told && Date.now() - this.problem.since > 5 * 60_000) {
      this.problem.told = true;
      if (hidden && this.settings.notify.problems && Notification.isSupported()) {
        this.notify(state.sync.status === 'offline' ? 'GigaCAD is offline' : 'GigaCAD can’t sync', state.sync.message ?? 'Syncing has been failing for 5 minutes. Open GigaCAD for details.');
      }
    }

    const count = needsYouCount(state);
    if (isWindows) {
      const overlay = count > 0 ? nativeImage.createFromPath(join(this.runtime.dir, 'icons', 'overlay.png')) : null;
      this.window?.setOverlayIcon(overlay && !overlay.isEmpty() ? overlay : null, count > 0 ? `${count} ${count === 1 ? 'thing needs' : 'things need'} you` : '');
    } else {
      app.setBadgeCount(count);
    }
  }

  /** Ends a timed pause on time, including one that ended while GigaCAD was closed. */
  private schedulePauseEnd(): void {
    clearTimeout(this.pauseTimer);
    const until = this.settings.paused ? this.settings.pausedUntil : null;
    if (!until) return;
    const wait = new Date(until).getTime() - Date.now();
    if (wait <= 0) return void this.run('setPaused', [false]);
    // Timers longer than about 24.8 days overflow; pauses never run that long.
    this.pauseTimer = setTimeout(() => void this.run('setPaused', [false]), Math.min(wait, 2 ** 31 - 1));
  }

  private buildAppMenu(): void {
    // Windows apps don't have an app menu; Settings is in the sidebar, and text editing works without one.
    if (isWindows) {
      Menu.setApplicationMenu(null);
      return;
    }
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
        { label: 'View', submenu: this.shortcutItems('view') },
        { label: 'Go', submenu: this.shortcutItems('go') },
        { role: 'windowMenu' },
      ]),
    );
  }

  /** Menu items for the shortcuts in one menu; choosing one sends its action to the window. */
  private shortcutItems(menu: 'view' | 'go'): MenuItemConstructorOptions[] {
    const send = (action: ShortcutAction) => {
      this.showWindow();
      this.window?.webContents.send('gigacad:shortcut', action);
    };
    return SHORTCUTS.filter((shortcut) => shortcut.menu === menu).flatMap((shortcut): MenuItemConstructorOptions[] => [
      ...(shortcut.action === 'zoomIn' || shortcut.action === 'back' || shortcut.action === 'project1' ? [{ type: 'separator' as const }] : []),
      { label: shortcut.label, accelerator: shortcut.accelerator, click: () => send(shortcut.action) },
    ]);
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
    setPaused: async (paused, duration = null) => {
      await this.updateSettings((settings) => ({ ...settings, paused, pausedUntil: paused ? pauseEnd(duration) : null }));
      this.schedulePauseEnd();
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
    dismissConflict: (projectId, path) => this.engine.dismissConflict(projectId, path),
    setNotify: async (kind, on) => {
      await this.updateSettings((settings) => ({ ...settings, notify: { ...settings.notify, [kind]: on } }));
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
    rootFiles: async (projectId) =>
      (await apiClient(this.settings.apiUrl)).get(`/v1/projects/${projectId}/files?area=root&sort=modified&order=desc&limit=30`),
    approveReleaseRequest: async (projectId, number) => {
      const project = this.project(projectId);
      await giga(['rr', 'approve', String(number), '--project', `${project.owner}/${project.slug}`], this.opts());
    },

    // The window joins paths with `/`; Windows wants its own separators.
    reveal: (path) => shell.showItemInFolder(normalize(path)),
    openPath: async (path) => {
      const problem = await shell.openPath(normalize(path));
      if (problem) throw new Error(problem);
    },
    openExternal: (url) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
    },
    openTerminal: (path) => openTerminal(path),
    copyText: (text) => clipboard.writeText(text),
    contextMenu: (items) =>
      new Promise<string | null>((resolve) => {
        let chosen: string | null = null;
        const menu = Menu.buildFromTemplate(
          items.flatMap((item): MenuItemConstructorOptions[] => [
            ...(item.separatorBefore ? [{ type: 'separator' as const }] : []),
            { label: item.label, enabled: item.enabled ?? true, click: () => (chosen = item.id) },
          ]),
        );
        // The click handler runs before the menu reports it closed.
        menu.popup({ ...(this.window ? { window: this.window } : {}), callback: () => setTimeout(() => resolve(chosen), 0) });
      }),
    zoom: async (direction) => {
      const level = direction === 'reset' ? 0 : Math.min(3, Math.max(-3, this.settings.zoom + (direction === 'in' ? 0.5 : -0.5)));
      this.window?.webContents.setZoomLevel(level);
      await this.updateSettings((settings) => ({ ...settings, zoom: level }));
    },
    webUrl: (projectId, path) => {
      const project = this.project(projectId);
      return treeUrl(this.settings.appUrl, project.owner, project.slug, path);
    },

    runSetup: async () => {
      await this.setup.runAll();
      await this.refreshInstallations();
      this.changed();
    },
    finishSetup: async () => {
      await this.updateSettings((settings) => ({ ...settings, setupDone: true }));
    },
    moveToApplications: () => {
      if (!this.setup.moveToApplications()) throw new Error('GigaCAD couldn’t move itself to Applications. Drag it there in Finder instead.');
    },
    installCli: async () => {
      const result = isWindows ? await installWindowsCli(supportDir()) : await installCli();
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
    if (!project) throw new Error(`That project isn’t synced to ${words.thisComputer}`);
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
      this.notify(`Checked out ${branch}`, `Its files are now editable on ${words.thisComputer}.`);
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

  /** A system notification; `opens` is where clicking it takes the window. */
  private notify(title: string, body: string, opens?: { projectId?: string; branch?: string | undefined }): void {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body });
    notification.on('click', () => this.showWindow(opens));
    notification.show();
  }

  private tell(title: string, message: string): void {
    void dialog.showMessageBox({ type: 'info', title: 'GigaCAD', message: title, detail: message, buttons: ['OK'] });
  }
}

/** A terminal in `path`: Terminal on macOS; Windows Terminal, or Command Prompt without it. */
function openTerminal(path: string): void {
  if (!isWindows) {
    execFile('/usr/bin/open', ['-a', 'Terminal', path]);
    return;
  }
  const terminal = spawn('wt.exe', ['-d', path], { detached: true, stdio: 'ignore' });
  terminal.on('error', () => spawn('cmd.exe', ['/c', 'start', '', '/d', path, 'cmd.exe'], { detached: true, stdio: 'ignore', windowsHide: true }).unref());
  terminal.unref();
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
