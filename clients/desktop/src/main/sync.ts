import { watch, type FSWatcher } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createIgnoreMatcher } from '@gigacad/core';
import type { Api, BranchView, ProjectSummary, ReleaseView, WorkspaceState } from '@gigacad/cli/lib';
import { platformWords } from '../shared/platform.js';
import type { ActivityItem, BranchState, Holder, ProjectState, ReleaseState, Settings, SyncStatus } from '../shared/types.js';
import { apiClient, thisMachine } from './api.js';
import { giga, GigaError, isGigaError } from './cli.js';
import { fileIconKey, type FolderIcon } from './iconArt.js';
import { applyIcons, type IconJob } from './icons.js';
import { branchDir, locate, projectDir, releaseDir } from './layout.js';
import { isLocked, lock, unlock, whileUnlocked } from './locks.js';
import { releasesToKeep } from './settings.js';

/** Marks a branch or release folder that isn't downloaded. Ignored by giga (packages/core). */
export const PLACEHOLDER = '.gigacad-placeholder';
/** Marks a downloaded release folder. */
const RELEASE_MARKER = '.gigacad-release.json';
/** The file that holds a folder's custom icon: Finder's "Icon" + carriage return, or Windows' desktop.ini. */
const ICON_FILE = process.platform === 'win32' ? 'desktop.ini' : 'Icon\r';

const AUTOSAVE_DELAY = 5_000;
const POLL_INTERVAL = 30_000;
const FULL_SYNC_INTERVAL = 5 * 60_000;

const isDefaultIgnored = createIgnoreMatcher();

interface ProjectRuntime {
  summary: ProjectSummary;
  branches: BranchView[];
  releases: ReleaseView[];
  lastEventId: number;
  error: string | null;
}

export interface EngineHost {
  settings(): Settings;
  updateSettings(change: (settings: Settings) => Settings): Promise<void>;
  /** Pre-rendered icons in the running bundle, and where new ones are drawn. */
  readonly iconsDir: string;
  readonly iconCacheDir: string;
  changed(): void;
}

const exists = (path: string) => stat(path).then(() => true, () => false);

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/**
 * Keeps ~/GigaCAD in step with the server, through the giga CLI:
 * - root files two ways (`giga root push`, which pulls first)
 * - each downloaded branch as a giga workspace, writable only while this Mac holds it; saves there
 *   become autosaves after 5 s of quiet (`giga commit --autosave`)
 * - releases exported and locked
 * Remote changes come from the project event feed, polled every 30 s.
 */
export class SyncEngine {
  user: { id: string; handle: string } | null = null;
  private machine = '';
  private api: Api | undefined;
  private readonly projects = new Map<string, ProjectRuntime>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly busyBranches = new Set<string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Scopes whose files the app is changing itself: their file events aren't the user's saves. */
  private readonly quiet = new Map<string, number>();
  private readonly iconCache = new Map<string, string>();
  private watcher: FSWatcher | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private fullTimer: NodeJS.Timeout | undefined;
  private active = 0;
  private status: SyncStatus = 'signed-out';
  private message: string | null = null;
  private lastSyncedAt: string | null = null;
  readonly activity: ActivityItem[] = [];

  constructor(private readonly host: EngineHost) {}

  // --- State for the window and the menu bar --------------------------------------------

  syncState() {
    const status: SyncStatus = this.host.settings().paused ? 'paused' : this.active > 0 ? 'syncing' : this.status;
    return { status, active: this.active, message: this.message, lastSyncedAt: this.lastSyncedAt };
  }

  projectStates(): ProjectState[] {
    const settings = this.host.settings();
    return [...this.projects.values()]
      .map(({ summary, branches, releases, error }) => {
        const dir = projectDir(settings.folder, summary.ownerHandle, summary.slug);
        return {
          id: summary.id,
          owner: summary.ownerHandle,
          slug: summary.slug,
          name: summary.name,
          role: summary.role,
          dir,
          hidden: settings.hiddenProjects.includes(summary.id),
          error,
          branches: branches.map((branch): BranchState => ({
            id: branch.id,
            name: branch.name,
            status: branch.status,
            downloaded: this.downloaded.has(branchDir(settings.folder, summary.ownerHandle, summary.slug, branch.name)),
            dir: branchDir(settings.folder, summary.ownerHandle, summary.slug, branch.name),
            holder: this.holder(branch),
            holderHandle: branch.checkedOutByHandle,
            holderMachine: branch.checkedOutMachine,
            headCommitId: branch.headCommitId,
            busy: this.busyBranches.has(`${summary.id}:${branch.name}`),
          })),
          releases: releases.map((release): ReleaseState => ({
            number: release.number,
            downloaded: this.downloaded.has(releaseDir(settings.folder, summary.ownerHandle, summary.slug, release.number)),
            dir: releaseDir(settings.folder, summary.ownerHandle, summary.slug, release.number),
            createdAt: release.createdAt,
            notes: release.notes,
          })),
        };
      })
      .sort((a, b) => `${a.owner}/${a.slug}`.localeCompare(`${b.owner}/${b.slug}`));
  }

  /** Branch and release folders known to be downloaded (checked during each sync). */
  private readonly downloaded = new Set<string>();

  private log(text: string, kind: ActivityItem['kind'] = 'info'): void {
    this.activity.unshift({ at: new Date().toISOString(), text, kind });
    this.activity.length = Math.min(this.activity.length, 50);
    this.host.changed();
  }

  private holder(branch: BranchView): Holder {
    if (!branch.checkedOutBy) return null;
    return branch.checkedOutBy === this.user?.id && branch.checkedOutMachine === this.machine ? 'me' : 'other';
  }

  // --- Lifecycle -----------------------------------------------------------------------

  /** Signs in from the saved credentials and starts syncing; false when signed out. */
  async start(): Promise<boolean> {
    this.stop();
    const settings = this.host.settings();
    this.api = await apiClient(settings.apiUrl);
    this.machine = await thisMachine();
    if (!this.api.signedIn) {
      this.user = null;
      this.status = 'signed-out';
      this.host.changed();
      return false;
    }
    try {
      const me = await this.api.get<{ id: string; handle: string }>('/v1/me');
      this.user = { id: me.id, handle: me.handle };
    } catch (error) {
      if (isApiError(error, 'unauthorized')) {
        this.user = null;
        this.status = 'signed-out';
        this.host.changed();
        return false;
      }
      this.setOffline(error);
      this.user = null;
    }
    await this.loadIconCache();
    this.startWatching();
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL);
    this.fullTimer = setInterval(() => void this.syncAll(), FULL_SYNC_INTERVAL);
    void this.syncAll();
    return true;
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
    clearInterval(this.pollTimer);
    clearInterval(this.fullTimer);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** True when no sync work is running or waiting, e.g. before restarting for an update. */
  idle(): boolean {
    return this.active === 0 && this.timers.size === 0;
  }

  private setOffline(error: unknown): void {
    this.status = isApiError(error, 'network') ? 'offline' : 'error';
    this.message = error instanceof Error ? error.message : String(error);
    this.host.changed();
  }

  /** Runs `work` after everything else queued for the project, counting it as active sync work. */
  private enqueue<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      this.active++;
      this.host.changed();
      try {
        return await work();
      } finally {
        this.active--;
        this.host.changed();
      }
    });
    this.queues.set(projectId, next);
    return next;
  }

  // --- Full sync -----------------------------------------------------------------------

  /** Lists the projects you're a member of and syncs each one. */
  async syncAll(): Promise<void> {
    if (!this.api || !this.user || this.host.settings().paused) return;
    let summaries: ProjectSummary[];
    try {
      summaries = await this.api.get<ProjectSummary[]>('/v1/projects');
    } catch (error) {
      this.setOffline(error);
      return;
    }
    const settings = this.host.settings();
    await mkdir(settings.folder, { recursive: true });
    for (const summary of summaries) {
      const known = this.projects.get(summary.id);
      if (known) known.summary = summary;
      else this.projects.set(summary.id, { summary, branches: [], releases: [], lastEventId: -1, error: null });
    }
    for (const id of this.projects.keys()) if (!summaries.some((summary) => summary.id === id)) this.projects.delete(id);
    await Promise.all(
      summaries.filter((summary) => !settings.hiddenProjects.includes(summary.id)).map((summary) => this.syncProject(summary.id)),
    );
    await this.iconPass(settings.folder, [
      { target: settings.folder, key: 'folder-root' },
      ...[...new Set(summaries.map((summary) => summary.ownerHandle))].map((owner) => ({ target: join(settings.folder, owner), key: 'folder-owner' })),
    ]);
    if (this.status !== 'offline' || this.active === 0) this.status = 'idle';
    this.message = null;
    this.lastSyncedAt = new Date().toISOString();
    this.host.changed();
  }

  /** Checks each project's event feed; anything new syncs that project. */
  async poll(): Promise<void> {
    if (!this.api || !this.user || this.host.settings().paused) return;
    for (const project of this.projects.values()) {
      if (this.host.settings().hiddenProjects.includes(project.summary.id)) continue;
      try {
        const events = await this.api.get<{ id: string }[]>(`/v1/projects/${project.summary.id}/events?after=${Math.max(project.lastEventId, 0)}&limit=500`);
        if (project.lastEventId < 0 || events.length > 0) void this.syncProject(project.summary.id);
        if (this.status === 'offline') {
          this.status = 'idle';
          this.host.changed();
        }
      } catch (error) {
        this.setOffline(error);
        return;
      }
    }
  }

  syncProject(projectId: string): Promise<void> {
    return this.enqueue(projectId, async () => {
      const project = this.projects.get(projectId);
      if (!project || !this.api) return;
      try {
        await this.reconcile(project);
        project.error = null;
      } catch (error) {
        project.error = describe(error);
        this.log(`${project.summary.ownerHandle}/${project.summary.slug}: ${project.error}`, 'error');
      }
    });
  }

  private async reconcile(project: ProjectRuntime): Promise<void> {
    const api = this.api!;
    const { summary } = project;
    const settings = this.host.settings();
    const dir = projectDir(settings.folder, summary.ownerHandle, summary.slug);
    const ref = `${summary.ownerHandle}/${summary.slug}`;

    // Note where the feed is before reading, so nothing that happens meanwhile is missed.
    const [latest] = await api.get<{ id: string }[]>(`/v1/projects/${summary.id}/events?order=desc&limit=1`);
    const eventId = latest ? Number(latest.id) : 0;

    // Root files, both ways. Viewers only pull.
    await mkdir(dir, { recursive: true });
    await this.quietly(`${summary.id}:root`, async () => {
      if (!(await exists(join(dir, '.giga', 'root.json')))) {
        await giga(['root', 'clone', ref, dir], this.opts(settings.folder));
        this.log(`Downloaded ${ref}`);
      } else {
        const result = await giga<{ conflicts?: { path: string; copy: string }[] }>(['root', summary.role === 'viewer' ? 'pull' : 'push'], this.opts(dir));
        for (const conflict of result.conflicts ?? []) this.log(`${ref}: ${conflict.path} changed here and on gigacad.site. Your version is ${conflict.copy}.`);
      }
    });

    project.branches = (await api.get<BranchView[]>(`/v1/projects/${summary.id}/branches`)).filter((branch) => branch.status !== 'archived');
    project.releases = await api.get<ReleaseView[]>(`/v1/projects/${summary.id}/releases`);
    project.releases.sort((a, b) => b.number - a.number);

    await this.reconcileBranches(project, dir);
    await this.reconcileReleases(project, dir);

    const icons: IconJob[] = [
      { target: dir, key: 'folder-project' },
      { target: join(dir, 'Branches'), key: 'folder-branches' },
      { target: join(dir, 'Releases'), key: 'folder-releases' },
    ];
    const inRoot = (path: string) => !path.startsWith(join(dir, 'Branches')) && !path.startsWith(join(dir, 'Releases'));
    await this.quietly(`${summary.id}:root`, () => this.iconPass(dir, icons, inRoot));
    project.lastEventId = eventId;
  }

  private async reconcileBranches(project: ProjectRuntime, dir: string): Promise<void> {
    const { summary } = project;
    const settings = this.host.settings();
    const wanted = new Set(settings.branches[summary.id] ?? []);
    const branchesDir = join(dir, 'Branches');
    await mkdir(branchesDir, { recursive: true });

    for (const branch of project.branches) {
      const bdir = join(branchesDir, branch.name);
      const holder = this.holder(branch);
      const workspace = await readJson<WorkspaceState>(join(bdir, '.giga', 'workspace.json'));
      if (!workspace) {
        this.downloaded.delete(bdir);
        if (holder === 'me' || wanted.has(branch.name)) await this.download(project, branch);
        else await this.placeholder(bdir, 'folder-branch-cloud');
        continue;
      }
      this.downloaded.add(bdir);
      await this.quietly(`${summary.id}:${branch.name}`, async () => {
        const locked = await isLocked(bdir);
        if (workspace.headCommitId !== branch.headCommitId) {
          if (locked) await whileUnlocked(bdir, () => giga(['pull'], this.opts(bdir)));
          else await giga(['pull'], this.opts(bdir));
        }
        if (holder === 'me' && locked) await unlock(bdir);
        await this.iconPass(bdir, [{ target: bdir, key: branchIcon(holder) }], undefined, holder !== 'me');
        if (holder !== 'me' && !(await isLocked(bdir))) await lock(bdir);
      });
    }

    // Placeholders for branches that were archived or deleted.
    for (const name of await readdir(branchesDir).catch(() => [] as string[])) {
      if (project.branches.some((branch) => branch.name === name)) continue;
      if (await exists(join(branchesDir, name, PLACEHOLDER))) await this.removePlaceholder(join(branchesDir, name));
    }
  }

  private async reconcileReleases(project: ProjectRuntime, dir: string): Promise<void> {
    const { summary } = project;
    const keep = releasesToKeep(this.host.settings(), summary.id);
    const releasesDir = join(dir, 'Releases');
    await mkdir(releasesDir, { recursive: true });
    for (const [index, release] of project.releases.entries()) {
      const rdir = join(releasesDir, `v${release.number}`);
      if (await exists(join(rdir, RELEASE_MARKER))) {
        this.downloaded.add(rdir);
        await this.quietly(`${summary.id}:v${release.number}`, async () => {
          if (!(await isLocked(rdir))) await lock(rdir);
        });
        continue;
      }
      this.downloaded.delete(rdir);
      const want = keep === 'all' || (keep === 'latest' && index === 0);
      if (want) await this.downloadReleaseNow(project, release.number);
      else await this.placeholder(rdir, 'folder-release-cloud');
    }
  }

  // --- Placeholders ----------------------------------------------------------------------

  /** An empty, locked folder with the "not downloaded" icon, so the branch or release shows in Finder. */
  private async placeholder(dir: string, key: FolderIcon): Promise<void> {
    if (await exists(join(dir, PLACEHOLDER))) {
      if (this.iconCache.get(dir) !== key) await whileUnlocked(dir, () => this.iconPass(dir, [{ target: dir, key }], () => false));
      return;
    }
    if (await exists(dir)) return; // Something else is there; leave it alone.
    await mkdir(dir, { recursive: true });
    const where = process.platform === 'win32' ? 'right-click → GigaCAD' : 'right-click → Quick Actions';
    await writeFile(join(dir, PLACEHOLDER), `Not downloaded. Use GigaCAD’s Download action (${where}) to get these files.\n`);
    await this.iconPass(dir, [{ target: dir, key }], () => false);
    await lock(dir);
  }

  /** Removes a placeholder folder, but only if nothing but the placeholder and its icon is in it. */
  private async removePlaceholder(dir: string): Promise<void> {
    await unlock(dir);
    const entries = await readdir(dir);
    if (entries.every((name) => name === PLACEHOLDER || name === ICON_FILE || name === '.DS_Store')) {
      await rm(dir, { recursive: true, force: true });
    } else {
      await lock(dir);
      throw new GigaError({ code: 'folder_not_empty', message: `${dir} has files in it that aren’t GigaCAD’s`, hint: 'Move them somewhere else, then try again.' });
    }
    this.iconCache.delete(dir);
  }

  // --- Branch actions ----------------------------------------------------------------------

  private opts(cwd: string) {
    return { cwd, apiUrl: this.host.settings().apiUrl };
  }

  private findProject(projectId: string): ProjectRuntime {
    const project = this.projects.get(projectId);
    if (!project) throw new GigaError({ code: 'not_found', message: `That project isn’t synced to ${platformWords(process.platform).thisComputer}` });
    return project;
  }

  private findBranch(project: ProjectRuntime, name: string): BranchView {
    const branch = project.branches.find((candidate) => candidate.name === name);
    if (!branch) throw new GigaError({ code: 'branch_not_found', message: `No branch named "${name}"` });
    return branch;
  }

  private bdir(project: ProjectRuntime, name: string): string {
    return branchDir(this.host.settings().folder, project.summary.ownerHandle, project.summary.slug, name);
  }

  /** Clones a branch next to its placeholder, then swaps it in, so a failed download leaves nothing half-done. */
  private async download(project: ProjectRuntime, branch: BranchView): Promise<void> {
    const { summary } = project;
    const bdir = this.bdir(project, branch.name);
    const temp = join(dirname(bdir), `.${branch.name}.downloading`);
    await this.quietly(`${summary.id}:${branch.name}`, async () => {
      await rm(temp, { recursive: true, force: true });
      await giga(['clone', `${summary.ownerHandle}/${summary.slug}`, temp, '--branch', branch.name], this.opts(dirname(bdir)));
      if (await exists(join(bdir, PLACEHOLDER))) await this.removePlaceholder(bdir);
      await rename(temp, bdir);
      this.downloaded.add(bdir);
      const holder = this.holder(branch);
      await this.iconPass(bdir, [{ target: bdir, key: branchIcon(holder) }]);
      if (holder !== 'me') await lock(bdir);
    });
    this.log(`Downloaded ${branch.name} of ${summary.ownerHandle}/${summary.slug}`);
  }

  downloadBranch(projectId: string, name: string): Promise<void> {
    return this.enqueue(projectId, async () => {
      const project = this.findProject(projectId);
      const branch = this.findBranch(project, name);
      await this.remember(projectId, name, true);
      if (!(await exists(join(this.bdir(project, name), '.giga', 'workspace.json')))) await this.download(project, branch);
    });
  }

  /** Deletes a branch's local copy (not the branch). Refuses while it has work that isn't on the server. */
  removeBranch(projectId: string, name: string): Promise<void> {
    return this.enqueue(projectId, async () => {
      const project = this.findProject(projectId);
      const bdir = this.bdir(project, name);
      if (this.holder(this.findBranch(project, name)) === 'me') {
        throw new GigaError({ code: 'checked_out', message: `You have ${name} checked out`, hint: 'Check it in first.' });
      }
      await unlock(bdir);
      await rm(bdir, { recursive: true, force: true });
      this.downloaded.delete(bdir);
      await this.remember(projectId, name, false);
      await this.placeholder(bdir, 'folder-branch-cloud');
      this.log(`Removed the local copy of ${name}`);
    });
  }

  checkout(projectId: string, name: string): Promise<void> {
    return this.branchAction(projectId, name, async (project, bdir) => {
      await this.remember(projectId, name, true);
      if (!(await exists(join(bdir, '.giga', 'workspace.json')))) await this.download(project, this.findBranch(project, name));
      await unlock(bdir);
      try {
        await giga(['checkout'], this.opts(bdir));
      } catch (error) {
        await lock(bdir);
        throw error;
      }
      await this.refreshBranches(project);
      await this.iconPass(bdir, [{ target: bdir, key: 'folder-branch-yours' }]);
      this.log(`Checked out ${name}. Its files are editable on ${platformWords(process.platform).thisComputer}.`);
    });
  }

  /** Saves any last changes as an autosave, gives up the lock, and makes the folder read-only again. */
  checkin(projectId: string, name: string): Promise<void> {
    return this.branchAction(projectId, name, async (project, bdir) => {
      this.cancelTimer(`${projectId}:${name}`);
      await this.autosaveNow(bdir);
      await giga(['checkin'], this.opts(bdir));
      await this.refreshBranches(project);
      await this.iconPass(bdir, [{ target: bdir, key: 'folder-branch' }]);
      await lock(bdir);
      this.log(`Checked in ${name}. Others can check it out now.`);
    });
  }

  commitVersion(projectId: string, name: string, message: string, label: string): Promise<void> {
    return this.branchAction(projectId, name, async (_project, bdir) => {
      this.cancelTimer(`${projectId}:${name}`);
      await giga(['commit', '-m', message, ...(label ? ['--label', label] : [])], this.opts(bdir));
      this.log(`Committed ${label ? `${label} ` : ''}on ${name}: “${message}”`);
    });
  }

  pull(projectId: string, name: string): Promise<void> {
    return this.branchAction(projectId, name, async (project, bdir) => {
      const branch = this.findBranch(project, name);
      if (this.holder(branch) === 'me') await giga(['pull'], this.opts(bdir));
      else await whileUnlocked(bdir, () => giga(['pull'], this.opts(bdir)));
      await this.iconPass(bdir, [], undefined, this.holder(branch) !== 'me');
    });
  }

  downloadRelease(projectId: string, number: number): Promise<void> {
    return this.enqueue(projectId, async () => {
      const project = this.findProject(projectId);
      if (!(await exists(join(releaseDir(this.host.settings().folder, project.summary.ownerHandle, project.summary.slug, number), RELEASE_MARKER)))) {
        await this.downloadReleaseNow(project, number);
      }
    });
  }

  private async downloadReleaseNow(project: ProjectRuntime, number: number): Promise<void> {
    const { summary } = project;
    const rdir = releaseDir(this.host.settings().folder, summary.ownerHandle, summary.slug, number);
    const temp = join(dirname(rdir), `.v${number}.downloading`);
    await rm(temp, { recursive: true, force: true });
    await giga(['release', 'export', String(number), temp, '--project', `${summary.ownerHandle}/${summary.slug}`], this.opts(dirname(rdir)));
    await writeFile(join(temp, RELEASE_MARKER), `${JSON.stringify({ number, downloadedAt: new Date().toISOString() })}\n`);
    if (await exists(join(rdir, PLACEHOLDER))) await this.removePlaceholder(rdir);
    await rename(temp, rdir);
    this.downloaded.add(rdir);
    await this.iconPass(rdir, [{ target: rdir, key: 'folder-release' }]);
    await lock(rdir);
    this.log(`Downloaded v${number} of ${summary.ownerHandle}/${summary.slug}`);
  }

  private branchAction(projectId: string, name: string, work: (project: ProjectRuntime, bdir: string) => Promise<void>): Promise<void> {
    const key = `${projectId}:${name}`;
    return this.enqueue(projectId, async () => {
      const project = this.findProject(projectId);
      this.findBranch(project, name);
      this.busyBranches.add(key);
      this.host.changed();
      try {
        await this.quietly(key, () => work(project, this.bdir(project, name)));
      } finally {
        this.busyBranches.delete(key);
        this.host.changed();
      }
    });
  }

  private async refreshBranches(project: ProjectRuntime): Promise<void> {
    project.branches = (await this.api!.get<BranchView[]>(`/v1/projects/${project.summary.id}/branches`)).filter((branch) => branch.status !== 'archived');
    this.host.changed();
  }

  private async remember(projectId: string, name: string, keep: boolean): Promise<void> {
    await this.host.updateSettings((settings) => {
      const current = new Set(settings.branches[projectId] ?? []);
      if (keep) current.add(name);
      else current.delete(name);
      return { ...settings, branches: { ...settings.branches, [projectId]: [...current] } };
    });
  }

  /** Records an autosave of the branch's current files; "nothing to commit" is fine. */
  private async autosaveNow(bdir: string): Promise<boolean> {
    try {
      await giga(['commit', '--autosave'], this.opts(bdir));
      return true;
    } catch (error) {
      if (isGigaError(error, 'nothing_to_commit')) return false;
      if (isGigaError(error, 'stale_head')) {
        // Someone else committed (a force-release, or another machine): catch up, then try once more.
        await giga(['pull'], this.opts(bdir));
        await giga(['commit', '--autosave'], this.opts(bdir)).catch((retry: unknown) => {
          if (!isGigaError(retry, 'nothing_to_commit')) throw retry;
        });
        return true;
      }
      throw error;
    }
  }

  // --- Watching saves ----------------------------------------------------------------------

  private startWatching(): void {
    const folder = this.host.settings().folder;
    try {
      this.watcher = watch(folder, { recursive: true }, (_event, filename) => {
        if (filename) this.onFileEvent(join(folder, filename.toString()));
      });
      this.watcher.on('error', () => undefined);
    } catch {
      // The folder doesn't exist yet; the first sync creates it and the next start watches it.
    }
  }

  private onFileEvent(path: string): void {
    const settings = this.host.settings();
    if (settings.paused) return;
    if (isAppFile(path)) return;
    const name = basename(path);
    try {
      if (isDefaultIgnored(name)) return;
    } catch {
      return;
    }
    const location = locate(settings.folder, path);
    if (!location?.owner || !location.project) return;
    const project = [...this.projects.values()].find(
      (candidate) => candidate.summary.ownerHandle === location.owner && candidate.summary.slug === location.project,
    );
    if (!project) return;
    const id = project.summary.id;

    if (location.area === 'branch' && location.name && location.inner) {
      const key = `${id}:${location.name}`;
      if (this.isQuiet(key)) return;
      const branch = project.branches.find((candidate) => candidate.name === location.name);
      if (!branch || this.holder(branch) !== 'me') return;
      this.debounce(key, () => void this.enqueue(id, () => this.quietly(key, async () => {
        try {
          if (await this.autosaveNow(location.areaDir!)) this.log(`Autosaved ${location.name} of ${project.summary.ownerHandle}/${project.summary.slug}`);
        } catch (error) {
          this.log(`Couldn’t autosave ${location.name}: ${describe(error)}`, 'error');
        }
      })));
    } else if (location.area === 'project-root' && location.inner) {
      const key = `${id}:root`;
      if (this.isQuiet(key)) return;
      this.debounce(key, () => void this.syncProject(id));
    }
  }

  private debounce(key: string, run: () => void): void {
    this.cancelTimer(key);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        run();
      }, AUTOSAVE_DELAY),
    );
  }

  private cancelTimer(key: string): void {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
  }

  private isQuiet(key: string): boolean {
    const until = this.quiet.get(key);
    return until !== undefined && (until === Infinity || until > Date.now());
  }

  /** Runs work that changes files itself; its file events (and a moment after) aren't treated as saves. */
  private async quietly<T>(key: string, work: () => Promise<T>): Promise<T> {
    this.quiet.set(key, Infinity);
    try {
      return await work();
    } finally {
      this.quiet.set(key, Date.now() + 1500);
    }
  }

  // --- Icons -------------------------------------------------------------------------------

  private get iconCacheFile(): string {
    return join(this.host.iconCacheDir, 'applied.json');
  }

  /** Which icon each path got, so a relaunch doesn't redo them all. Keyed by path; the value is `<key>@<stamp>`. */
  private async loadIconCache(): Promise<void> {
    this.iconCache.clear();
    const saved = await readJson<Record<string, string>>(this.iconCacheFile);
    for (const [path, value] of Object.entries(saved ?? {})) this.iconCache.set(path, value);
  }

  private async saveIconCache(): Promise<void> {
    await mkdir(this.host.iconCacheDir, { recursive: true });
    await writeFile(this.iconCacheFile, JSON.stringify(Object.fromEntries(this.iconCache)));
  }

  /**
   * Gives every folder and file under `dir` its icon (only what changed), plus the `extra` jobs.
   * `include` limits which paths are walked. A `locked` tree is unlocked while icons change.
   */
  private async iconPass(dir: string, extra: IconJob[], include: (path: string) => boolean = () => true, locked = false): Promise<void> {
    const jobs: IconJob[] = [];
    for (const job of extra) if (await this.needsIcon(job)) jobs.push(job);
    const walk = async (current: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
        const name = entry.name;
        if (name.startsWith('.') || name === ICON_FILE) continue;
        const path = join(current, name);
        if (!include(path)) continue;
        if (entry.isDirectory()) {
          const job = { target: path, key: 'folder-plain' };
          if (await this.needsIcon(job)) jobs.push(job);
          await walk(path);
        } else if (entry.isFile() && !isIgnoredName(name)) {
          const job = { target: path, key: fileIconKey(name) };
          if (await this.needsIcon(job)) jobs.push(job);
        }
      }
    };
    await walk(dir);
    if (jobs.length === 0) return;
    const apply = () => applyIcons(jobs, this.host.iconsDir, this.host.iconCacheDir);
    const result = locked ? await whileUnlocked(dir, apply) : await apply();
    const failed = new Set(result.failed);
    for (const job of jobs) if (!failed.has(job.target)) this.iconCache.set(job.target, `${job.key}@${await fileStamp(job.target)}`);
    await this.saveIconCache();
  }

  private async needsIcon(job: IconJob): Promise<boolean> {
    const cached = this.iconCache.get(job.target);
    if (!cached || !cached.startsWith(`${job.key}@`)) return true;
    // A file replaced by a save or a pull loses its icon; so does a folder whose Icon file was removed.
    return cached !== `${job.key}@${await fileStamp(job.target)}`;
  }
}

const branchIcon = (holder: Holder): FolderIcon => (holder === 'me' ? 'folder-branch-yours' : holder === 'other' ? 'folder-branch-theirs' : 'folder-branch');

/** Changes when a file is replaced, or when a folder's custom icon file goes away. */
async function fileStamp(path: string): Promise<string> {
  try {
    const info = await lstat(path);
    if (info.isDirectory()) return (await exists(join(path, ICON_FILE))) ? 'icon' : 'none';
    return `${info.ino}:${info.size}:${info.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

/**
 * Files the app and giga write themselves, which must never look like a save: giga's `.giga`
 * state, downloads in progress, and GigaCAD's markers and icon files. Paths may use either
 * separator; Windows paths use backslashes.
 */
export function isAppFile(path: string): boolean {
  const parts = path.split(/[\\/]/);
  const name = parts[parts.length - 1] ?? '';
  if (name === 'Icon\r' || name === 'desktop.ini' || name === PLACEHOLDER || name === RELEASE_MARKER) return true;
  return parts.some((part) => part === '.giga' || part.endsWith('.downloading'));
}

function isIgnoredName(name: string): boolean {
  try {
    return isDefaultIgnored(name);
  } catch {
    return true;
  }
}

function isApiError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}

export function describe(error: unknown): string {
  if (error instanceof GigaError) return error.hint ? `${error.message}. ${error.hint}` : error.message;
  return error instanceof Error ? error.message : String(error);
}
