// Types shared by the main process and the window.

export type ReleasesToKeep = 'latest' | 'all' | 'none';

export interface Settings {
  /** The GigaCAD folder, ~/GigaCAD by default. */
  readonly folder: string;
  readonly apiUrl: string;
  readonly appUrl: string;
  readonly startAtLogin: boolean;
  readonly paused: boolean;
  /** Per project id; 'latest' when unset. */
  readonly releases: Readonly<Record<string, ReleasesToKeep>>;
  /** Branch names downloaded per project id (branches you check out are downloaded too). */
  readonly branches: Readonly<Record<string, readonly string[]>>;
  /** Project ids not synced to this Mac. */
  readonly hiddenProjects: readonly string[];
  readonly setupDone: boolean;
  /** An update version whose banner was closed with ×. */
  readonly dismissedUpdate: string | null;
}

export type Holder = 'me' | 'other' | null;

export interface BranchState {
  readonly id: string;
  readonly name: string;
  readonly status: 'open' | 'frozen' | 'released' | 'archived';
  readonly downloaded: boolean;
  readonly dir: string;
  readonly holder: Holder;
  readonly holderHandle: string | null;
  readonly holderMachine: string | null;
  readonly headCommitId: string;
  readonly busy: boolean;
}

export interface ReleaseState {
  readonly number: number;
  readonly downloaded: boolean;
  readonly dir: string;
  readonly createdAt: string;
  readonly notes: string;
}

export interface ProjectState {
  readonly id: string;
  readonly owner: string;
  readonly slug: string;
  readonly name: string;
  readonly role: 'owner' | 'maintainer' | 'contributor' | 'viewer' | null;
  readonly dir: string;
  readonly hidden: boolean;
  readonly branches: readonly BranchState[];
  readonly releases: readonly ReleaseState[];
  readonly error: string | null;
}

export type SyncStatus = 'idle' | 'syncing' | 'paused' | 'offline' | 'error' | 'signed-out';

export interface ActivityItem {
  readonly at: string;
  readonly text: string;
  readonly kind: 'info' | 'error';
}

export type SetupStepId = 'applications' | 'signin' | 'folder' | 'quickActions' | 'urlScheme' | 'cli' | 'login';

export interface SetupStep {
  readonly id: SetupStepId;
  readonly title: string;
  readonly status: 'todo' | 'done' | 'skipped' | 'error' | 'running';
  readonly detail: string | null;
  readonly optional: boolean;
}

export type UpdateState =
  | { readonly kind: 'idle'; readonly lastChecked: string | null }
  | { readonly kind: 'checking'; readonly lastChecked: string | null }
  | { readonly kind: 'downloading'; readonly version: string; readonly progress: number; readonly lastChecked: string | null }
  | {
      readonly kind: 'ready';
      readonly version: string;
      readonly notes: string;
      readonly notesUrl: string | null;
      readonly restarting: boolean;
      readonly lastChecked: string | null;
    }
  | {
      readonly kind: 'needsReinstall';
      readonly version: string;
      readonly notes: string;
      /** The full app to download again: the DMG on macOS, the installer on Windows. */
      readonly downloadUrl: string;
      readonly lastChecked: string | null;
    }
  | { readonly kind: 'error'; readonly message: string; readonly lastChecked: string | null };

/** A CAD plugin (src/main/plugins), for the plugin list in Settings. */
export interface PluginState {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly state: 'active' | 'failed';
  readonly error: string | null;
  /** Capabilities turned off after an error, until GigaCAD restarts. */
  readonly turnedOff: readonly string[];
  readonly installations: readonly { readonly version: string; readonly installPath: string; readonly addInRegistered: boolean }[];
  /** How many copies of the CAD program have GigaCAD's add-in connected. */
  readonly addInsConnected: number;
}

export interface AppState {
  readonly user: { readonly handle: string; readonly apiUrl: string } | null;
  /** A device sign-in waiting for approval in the browser. */
  readonly signIn: { readonly userCode: string; readonly verificationUri: string } | null;
  readonly settings: Settings;
  readonly sync: { readonly status: SyncStatus; readonly active: number; readonly message: string | null; readonly lastSyncedAt: string | null };
  readonly projects: readonly ProjectState[];
  readonly activity: readonly ActivityItem[];
  readonly setup: readonly SetupStep[];
  readonly updates: UpdateState;
  readonly rolledBackFrom: string | null;
  readonly plugins: readonly PluginState[];
  readonly app: {
    readonly version: string;
    readonly shellVersion: number;
    readonly source: string;
    readonly cliInstalled: string | null;
    /** process.platform: 'darwin' or 'win32'. */
    readonly platform: string;
  };
}

/** A giga error, as the CLI reports it with --json. */
export interface GigaErrorInfo {
  readonly code: string;
  readonly message: string;
  readonly hint?: string | undefined;
}

/** What the window asks the main process to do. Each maps to one IPC channel. */
export interface Commands {
  getState(): AppState;
  signIn(): void;
  cancelSignIn(): void;
  signOut(): void;
  syncNow(): void;
  setPaused(paused: boolean): void;
  updateSettings(change: Partial<Pick<Settings, 'startAtLogin' | 'folder'>>): void;
  /** Asks for a new GigaCAD folder; the next sync fills it. */
  chooseFolder(): void;
  setReleasesToKeep(projectId: string, keep: ReleasesToKeep): void;
  setProjectHidden(projectId: string, hidden: boolean): void;

  checkout(projectId: string, branch: string): void;
  checkin(projectId: string, branch: string): void;
  commitVersion(projectId: string, branch: string, message: string, label: string): void;
  pull(projectId: string, branch: string): void;
  downloadBranch(projectId: string, branch: string): void;
  removeBranch(projectId: string, branch: string): void;
  downloadRelease(projectId: string, number: number): void;
  createBranch(projectId: string, name: string, fromRelease: number | null): void;

  branchStatus(projectId: string, branch: string): unknown;
  branchHistory(projectId: string, branch: string): unknown;
  releaseRequests(projectId: string): unknown;
  openReleaseRequest(projectId: string, branch: string, title: string, body: string): unknown;
  approveReleaseRequest(projectId: string, number: number): void;

  reveal(path: string): void;
  openExternal(url: string): void;
  openTerminal(path: string): void;
  webUrl(projectId: string, path: string): string;

  runSetup(): void;
  finishSetup(): void;
  /** Moves the app to /Applications and relaunches it (macOS asks first). */
  moveToApplications(): void;
  installCli(): void;

  checkForUpdates(): void;
  restartToUpdate(): void;
  dismissUpdate(): void;
  dismissRollback(): void;
}

export type CommandName = keyof Commands;

export const COMMAND_NAMES: readonly CommandName[] = [
  'getState', 'signIn', 'cancelSignIn', 'signOut', 'syncNow', 'setPaused', 'updateSettings', 'chooseFolder', 'setReleasesToKeep', 'setProjectHidden',
  'checkout', 'checkin', 'commitVersion', 'pull', 'downloadBranch', 'removeBranch', 'downloadRelease', 'createBranch',
  'branchStatus', 'branchHistory', 'releaseRequests', 'openReleaseRequest', 'approveReleaseRequest',
  'reveal', 'openExternal', 'openTerminal', 'webUrl',
  'runSetup', 'finishSetup', 'moveToApplications', 'installCli',
  'checkForUpdates', 'restartToUpdate', 'dismissUpdate', 'dismissRollback',
];

/** Result of a command over IPC: errors travel as data, so the window can show giga's hint. */
export type CommandResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: GigaErrorInfo };
