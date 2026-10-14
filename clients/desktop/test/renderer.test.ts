import { describe, expect, it } from 'vitest';
import type { UpdateState } from '../src/shared/types.js';
import { unreadErrors } from '../src/renderer/activity.js';
import { bannerFor } from '../src/renderer/banner.js';
import { groupHistory, type Commit } from '../src/renderer/history.js';
import { FIXTURES } from '../src/renderer/preview/fixtures.js';
import { mainView } from '../src/renderer/view.js';

const ready: UpdateState = { kind: 'ready', version: '0.3.0', notes: 'Faster sync', notesUrl: null, restarting: false, lastChecked: null };

describe('bannerFor', () => {
  it('shows nothing while idle, checking, or after an error', () => {
    expect(bannerFor({ kind: 'idle', lastChecked: null }, null, null)).toBeNull();
    expect(bannerFor({ kind: 'checking', lastChecked: null }, null, null)).toBeNull();
    expect(bannerFor({ kind: 'error', message: 'offline', lastChecked: null }, null, null)).toBeNull();
  });

  it('shows download progress as a whole percent', () => {
    expect(bannerFor({ kind: 'downloading', version: '0.3.0', progress: 0.424, lastChecked: null }, null, null)).toEqual({ kind: 'downloading', percent: 42 });
  });

  it('offers a restart, unless that version was dismissed', () => {
    expect(bannerFor(ready, null, null)).toMatchObject({ kind: 'ready', version: '0.3.0', restarting: false });
    expect(bannerFor(ready, '0.3.0', null)).toBeNull();
    expect(bannerFor(ready, '0.2.0', null)).toMatchObject({ kind: 'ready' });
  });

  it('offers the DMG when the update needs a new shell', () => {
    const state: UpdateState = { kind: 'needsReinstall', version: '1.0.0', notes: '', downloadUrl: 'https://x/GigaCAD.dmg', lastChecked: null };
    expect(bannerFor(state, null, null)).toMatchObject({ kind: 'reinstall', downloadUrl: 'https://x/GigaCAD.dmg' });
  });

  it('puts the rollback notice first', () => {
    expect(bannerFor(ready, null, '0.2.1')).toEqual({ kind: 'rollback', version: '0.2.1' });
  });
});

describe('groupHistory', () => {
  const commit = (id: string, kind: Commit['kind']): Commit => ({ id, kind, message: id, versionLabel: null, authorHandle: 'a', createdAt: '2026-01-01T00:00:00Z' });

  it('folds each run of autosaves into one row', () => {
    const rows = groupHistory([commit('a3', 'autosave'), commit('a2', 'autosave'), commit('v2', 'version'), commit('a1', 'autosave'), commit('v1', 'version')]);
    expect(rows.map((row) => (row.version ? row.version.id : row.autosaves!.map((c) => c.id).join('+')))).toEqual(['a3+a2', 'v2', 'a1', 'v1']);
  });
});

describe('mainView', () => {
  const state = FIXTURES.find((fixture) => fixture.name === 'project')!.state;
  const hide = (id: string) => ({ ...state, projects: state.projects.map((project) => (project.id === id ? { ...project, hidden: true } : project)) });

  it('opens a selected branch, and a project without one', () => {
    expect(mainView(state, { kind: 'project', projectId: 'rover', branch: 'wheel-hub' })).toMatchObject({ kind: 'branch', branch: { name: 'wheel-hub' } });
    expect(mainView(state, { kind: 'project', projectId: 'rover' })).toMatchObject({ kind: 'project', project: { id: 'rover' } });
  });

  it('offers Sync again for a project that stopped syncing, instead of still showing it', () => {
    expect(mainView(hide('rover'), { kind: 'project', projectId: 'rover', branch: 'wheel-hub' })).toMatchObject({ kind: 'hidden', project: { id: 'rover' } });
  });

  it('shows the first synced project when nothing is selected', () => {
    expect(mainView(hide('rover'), { kind: 'none' })).toMatchObject({ kind: 'project', project: { id: 'gripper' } });
    expect(mainView({ ...state, projects: [] }, { kind: 'none' })).toEqual({ kind: 'empty' });
  });
});

describe('unreadErrors', () => {
  it('counts only errors newer than the last look', () => {
    const items = [
      { at: '2026-10-14T10:05:00Z', text: 'Couldn’t autosave', kind: 'error' as const },
      { at: '2026-10-14T10:04:00Z', text: 'Autosaved', kind: 'info' as const },
      { at: '2026-10-14T09:00:00Z', text: 'Offline', kind: 'error' as const },
    ];
    expect(unreadErrors(items, '').map((item) => item.at)).toEqual(['2026-10-14T10:05:00Z', '2026-10-14T09:00:00Z']);
    expect(unreadErrors(items, '2026-10-14T10:00:00Z').map((item) => item.text)).toEqual(['Couldn’t autosave']);
  });
});
