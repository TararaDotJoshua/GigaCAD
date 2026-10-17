// Sample app states for the browser preview (preview.tsx) and the layout check
// (test/layout.e2e.ts). Names and sizes follow the 2026-10-07 audit, which found most of
// the layout bugs with these projects.
import type { Navigate } from '../../preload/index.js';
import type { AppState, BranchState, ProjectState, ReleaseState, SetupStep } from '../../shared/types.js';
import type { Commit } from '../history.js';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const daysAgo = (days: number) => minutesAgo(days * 24 * 60);

function branch(name: string, change: Partial<BranchState> = {}): BranchState {
  return {
    id: `branch-${name}`,
    name,
    status: 'open',
    downloaded: true,
    dir: `/Users/sam/GigaCAD/josh/mars-rover-chassis/Branches/${name}`,
    holder: null,
    holderHandle: null,
    holderMachine: null,
    headCommitId: `head-${name}`,
    busy: false,
    ...change,
  };
}

function release(number: number, notes: string, days: number, downloaded = false): ReleaseState {
  return { number, notes, downloaded, dir: `/Users/sam/GigaCAD/josh/mars-rover-chassis/Releases/v${number}`, createdAt: daysAgo(days) };
}

const rover: ProjectState = {
  id: 'rover',
  owner: 'josh',
  slug: 'mars-rover-chassis',
  name: 'Mars Rover Chassis',
  role: 'maintainer',
  dir: '/Users/sam/GigaCAD/josh/mars-rover-chassis',
  hidden: false,
  branches: [
    branch('suspension-v3', { holder: 'me', holderHandle: 'sam', holderMachine: 'Sam’s MacBook Pro', headCommitId: 'c9' }),
    branch('wheel-hub', { holder: 'other', holderHandle: 'josh', holderMachine: 'Josh’s PC' }),
    branch('gripper', { downloaded: false }),
    branch('battery-tray-rev-b', { status: 'frozen', downloaded: false }),
    branch('mast-camera', { downloaded: false }),
  ],
  releases: [
    release(4, 'Stiffer rocker arms and the new wheel hub bearings', 13, true),
    release(3, 'First print-ready chassis', 40),
    release(2, 'Battery tray moved forward', 61),
  ],
  error: null,
};

const projects: readonly ProjectState[] = [
  rover,
  {
    id: 'gripper',
    owner: 'josh',
    slug: 'soft-gripper',
    name: 'Soft Gripper',
    role: 'contributor',
    dir: '/Users/sam/GigaCAD/josh/soft-gripper',
    hidden: false,
    branches: [branch('fingers-v2', { downloaded: false })],
    releases: [release(1, 'First release', 5)],
    error: null,
  },
  {
    id: 'drone',
    owner: 'sam',
    slug: 'drone-frame',
    name: 'Drone Frame',
    role: 'owner',
    dir: '/Users/sam/GigaCAD/sam/drone-frame',
    hidden: false,
    branches: [],
    releases: [],
    error: null,
  },
];

const doneSteps: readonly SetupStep[] = [
  { id: 'applications', title: 'Move GigaCAD to Applications', status: 'done', detail: null, optional: false },
  { id: 'signin', title: 'Sign in', status: 'done', detail: null, optional: false },
  { id: 'folder', title: 'Choose the GigaCAD folder', status: 'done', detail: null, optional: false },
  { id: 'quickActions', title: 'Add Quick Actions', status: 'done', detail: null, optional: true },
  { id: 'urlScheme', title: 'Open gigacad:// links', status: 'done', detail: null, optional: false },
  { id: 'cli', title: 'Install the giga command', status: 'done', detail: null, optional: true },
  { id: 'login', title: 'Open at login', status: 'done', detail: null, optional: true },
];

const base: AppState = {
  user: { handle: 'sam', apiUrl: 'https://api.gigacad.site' },
  signIn: null,
  settings: {
    folder: '/Users/sam/GigaCAD',
    apiUrl: 'https://api.gigacad.site',
    appUrl: 'https://app.gigacad.site',
    startAtLogin: true,
    paused: false,
    releases: {},
    branches: { rover: ['suspension-v3', 'wheel-hub'] },
    hiddenProjects: [],
    setupDone: true,
    dismissedUpdate: null,
  },
  sync: { status: 'idle', active: 0, message: null, lastSyncedAt: minutesAgo(3) },
  projects,
  activity: [
    { at: minutesAgo(3), text: 'Autosaved suspension-v3', kind: 'info' },
    { at: minutesAgo(9), text: 'Downloaded wheel-hub', kind: 'info' },
  ],
  setup: doneSteps,
  updates: { kind: 'idle', lastChecked: minutesAgo(30) },
  rolledBackFrom: null,
  plugins: [],
  app: { version: '0.2.0', shellVersion: 1, source: 'bundle', cliInstalled: '0.1.0', platform: 'darwin' },
};

export interface Fixture {
  readonly name: string;
  readonly state: AppState;
  /** Where the window starts, as the menu and Quick Actions would send it. */
  readonly navigate?: Navigate;
  /** A tab to open after loading, by its label. */
  readonly tab?: string;
  /** A button to press after loading, by its accessible name: a menu or popover to check. */
  readonly press?: string;
}

const withProjects = (change: (project: ProjectState) => ProjectState): readonly ProjectState[] =>
  projects.map((project) => (project.id === 'rover' ? change(project) : project));

export const FIXTURES: readonly Fixture[] = [
  { name: 'signed-out', state: { ...base, user: null } },
  {
    name: 'first-run',
    state: {
      ...base,
      settings: { ...base.settings, setupDone: false },
      setup: doneSteps.map((step) => (step.id === 'quickActions' ? { ...step, status: 'todo' } : step.id === 'cli' ? { ...step, status: 'running' } : step)),
    },
  },
  { name: 'project', state: base, navigate: { projectId: 'rover' } },
  { name: 'project-requests', state: base, navigate: { projectId: 'rover' }, tab: 'Release requests' },
  { name: 'project-empty', state: base, navigate: { projectId: 'drone' } },
  { name: 'branch-mine', state: base, navigate: { projectId: 'rover', branch: 'suspension-v3' } },
  { name: 'branch-history', state: base, navigate: { projectId: 'rover', branch: 'suspension-v3' }, tab: 'History' },
  { name: 'branch-menu', state: base, navigate: { projectId: 'rover', branch: 'suspension-v3' }, press: 'More actions' },
  { name: 'branch-other', state: base, navigate: { projectId: 'rover', branch: 'wheel-hub' } },
  { name: 'branch-not-downloaded', state: base, navigate: { projectId: 'rover', branch: 'gripper' } },
  {
    name: 'project-hidden',
    state: { ...base, projects: withProjects((project) => ({ ...project, hidden: true })), settings: { ...base.settings, hiddenProjects: ['rover'] } },
    navigate: { projectId: 'rover' },
  },
  {
    name: 'settings-failed',
    state: { ...base, setup: doneSteps.map((step) => (step.id === 'cli' ? { ...step, status: 'error', detail: 'Couldn’t write /usr/local/bin/giga: permission denied' } : step)) },
    navigate: { projectId: 'settings' },
  },
  {
    name: 'sync-problem',
    state: { ...base, sync: { status: 'error', active: 0, message: 'api.gigacad.site answered 503', lastSyncedAt: minutesAgo(40) } },
    navigate: { projectId: 'rover' },
    press: 'Sync problem',
  },
  {
    name: 'update-ready',
    state: {
      ...base,
      updates: {
        kind: 'ready',
        version: '0.3.0',
        notes: 'Faster sync for large assemblies.\nRelease requests refresh on their own.\nFixes for the toolbar at small window sizes.',
        notesUrl: null,
        restarting: false,
        lastChecked: minutesAgo(2),
      },
    },
    navigate: { projectId: 'rover' },
  },
];

/** Sample answers for the commands views load data with. */
export const SAMPLE_STATUS = {
  remote: { status: 'ok', behind: false },
  changes: [
    { kind: 'modified', path: 'suspension/rocker-arm.SLDPRT' },
    { kind: 'modified', path: 'suspension/bogie.SLDASM' },
    { kind: 'added', path: 'suspension/bearing-spacer.SLDPRT' },
    { kind: 'deleted', path: 'drawings/old-rocker.SLDDRW' },
    { kind: 'moved', path: 'suspension/wheel/hub-cap.SLDPRT', from: 'hub-cap.SLDPRT' },
  ],
};

export const SAMPLE_HISTORY: readonly Commit[] = [
  { id: 'c9', kind: 'autosave', message: '', versionLabel: null, authorHandle: 'sam', createdAt: minutesAgo(3) },
  { id: 'c8', kind: 'autosave', message: '', versionLabel: null, authorHandle: 'sam', createdAt: minutesAgo(12) },
  { id: 'c7', kind: 'version', message: 'Thicker rocker arm walls for printing', versionLabel: 'for print', authorHandle: 'sam', createdAt: daysAgo(1) },
  { id: 'c6', kind: 'autosave', message: '', versionLabel: null, authorHandle: 'sam', createdAt: daysAgo(2) },
  { id: 'c5', kind: 'version', message: 'Branch from v4', versionLabel: null, authorHandle: 'sam', createdAt: daysAgo(13) },
];

export const SAMPLE_REQUESTS = [
  { id: 'r7', number: 7, title: 'Battery tray rev B', status: 'candidate', branchName: 'battery-tray-rev-b', requesterHandle: 'josh', updatedAt: minutesAgo(50), candidateManifestId: '00000000-0000-4000-8000-000000000007' },
  { id: 'r6', number: 6, title: 'Stiffer rocker arms', status: 'released', branchName: 'rockers', requesterHandle: 'sam', updatedAt: daysAgo(13) },
];
