// What each shortcut does in the window (the keys are in shared/shortcuts.ts).
import type { ShortcutAction } from '../shared/shortcuts.js';
import type { AppState } from '../shared/types.js';
import { act } from './api.js';
import { refreshViews, request } from './navigation.js';
import { branchUrl, projectUrl } from './urls.js';
import { mainView, type Selection } from './view.js';

interface Navigation {
  readonly select: (selection: Selection) => void;
  readonly back: () => void;
  readonly forward: () => void;
}

/** Projects in sidebar order: grouped by owner, in the order the owners first appear. */
export function sidebarProjects(state: AppState) {
  const projects = state.projects.filter((project) => !project.hidden);
  const owners = [...new Set(projects.map((project) => project.owner))];
  return owners.flatMap((owner) => projects.filter((project) => project.owner === owner));
}

export function runShortcutAction(action: ShortcutAction, state: AppState, selection: Selection, nav: Navigation): void {
  const view = mainView(state, selection);
  switch (action) {
    case 'settings':
      return nav.select({ kind: 'settings' });
    case 'back':
      return nav.back();
    case 'forward':
      return nav.forward();
    case 'refresh':
      refreshViews();
      void act('syncNow');
      return;
    case 'filter':
      request('filter');
      return;
    case 'zoomIn':
      return void act('zoom', 'in');
    case 'zoomOut':
      return void act('zoom', 'out');
    case 'zoomReset':
      return void act('zoom', 'reset');
    case 'commit':
      // The commit box takes it when it's showing; otherwise go to the branch you hold, ready to commit.
      if (request('commit')) return;
      if (view.kind === 'branch' && view.branch.holder === 'me') return nav.select({ kind: 'project', projectId: view.project.id, branch: view.branch.name, commit: true });
      return;
    case 'openWeb':
      if (view.kind === 'branch') return void act('openExternal', branchUrl(state, view.project, view.branch.name));
      if (view.kind === 'project') return void act('openExternal', projectUrl(state, view.project));
      return;
    case 'reveal':
      if (view.kind === 'branch' && view.branch.downloaded) return void act('reveal', view.branch.dir);
      if (view.kind === 'project') return void act('reveal', view.project.dir);
      return;
    default: {
      const project = sidebarProjects(state)[Number(action.slice('project'.length)) - 1];
      if (project) nav.select({ kind: 'project', projectId: project.id });
    }
  }
}
