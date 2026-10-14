// The actions for each kind of row, shared by its ⋯ menu and its right-click menu, so the two
// always offer the same things. Right-click menus are native (main/controller.ts contextMenu).
import type { MouseEvent } from 'react';
import { platformWords } from '../shared/platform.js';
import type { AppState, BranchState, ProjectState, ReleaseState } from '../shared/types.js';
import { act, call, toast } from './api.js';
import type { MenuItem } from './components/Menu.js';
import { ask } from './confirm.js';
import { branchUrl, projectUrl, releaseUrl } from './urls.js';

export type MenuItems = readonly (MenuItem | null | false | undefined)[];

const copy = (text: string, what = 'Link') => void act('copyText', text).then((ok) => ok && toast(`${what} copied`));

export function projectItems(state: AppState, project: ProjectState): MenuItems {
  const words = platformWords(state.app.platform);
  const url = projectUrl(state, project);
  return [
    { label: words.showInFileManager, onSelect: () => void act('reveal', project.dir) },
    { label: 'Open on gigacad.site', onSelect: () => void act('openExternal', url) },
    { label: 'Copy link', onSelect: () => copy(url) },
    { label: `Open in ${words.terminal}`, onSelect: () => void act('openTerminal', project.dir) },
    stopSyncing(project),
  ];
}

export function branchItems(state: AppState, project: ProjectState, branch: BranchState): MenuItems {
  const words = platformWords(state.app.platform);
  const url = branchUrl(state, project, branch.name);
  const canCheckOut = branch.holder === null && branch.status === 'open' && project.role !== null && project.role !== 'viewer';
  return [
    branch.downloaded && { label: words.showInFileManager, onSelect: () => void act('reveal', branch.dir) },
    { label: 'Open on gigacad.site', onSelect: () => void act('openExternal', url) },
    { label: 'Copy link', onSelect: () => copy(url) },
    branch.downloaded && { label: `Open in ${words.terminal}`, onSelect: () => void act('openTerminal', branch.dir) },
    canCheckOut && { label: 'Check Out', onSelect: () => void act('checkout', project.id, branch.name).then((ok) => ok && toast(`Checked out ${branch.name}`)) },
    branch.holder === 'me' && { label: 'Check In', onSelect: () => void act('checkin', project.id, branch.name).then((ok) => ok && toast(`Checked in ${branch.name}`)) },
    !branch.downloaded && { label: 'Download', onSelect: () => void act('downloadBranch', project.id, branch.name).then((ok) => ok && toast(`Downloaded ${branch.name}`)) },
    branch.downloaded &&
      branch.holder !== 'me' && {
        label: 'Remove download',
        danger: true,
        confirm: removeSentence(branch.name),
        onSelect: () => void act('removeBranch', project.id, branch.name).then((ok) => ok && toast(`Removed the download of ${branch.name}`)),
      },
    stopSyncing(project),
  ];
}

export function releaseItems(state: AppState, project: ProjectState, release: ReleaseState): MenuItems {
  const words = platformWords(state.app.platform);
  const url = releaseUrl(state, project, release.number);
  return [
    release.downloaded && { label: words.showInFileManager, onSelect: () => void act('reveal', release.dir) },
    { label: 'Open on gigacad.site', onSelect: () => void act('openExternal', url) },
    { label: 'Copy link', onSelect: () => copy(url) },
    release.downloaded && { label: `Open in ${words.terminal}`, onSelect: () => void act('openTerminal', release.dir) },
    !release.downloaded && { label: 'Download', onSelect: () => void act('downloadRelease', project.id, release.number).then((ok) => ok && toast(`Downloaded v${release.number}`)) },
  ];
}

/** The sentences from the desktop UX plan, phase 7. */
export const removeSentence = (name: string) => `Removes the local copy of ${name}. Nothing on gigacad.site changes.`;
export const STOP_SYNCING = 'GigaCAD stops updating this project’s folder. The folder stays where it is.';

export const stopSyncing = (project: ProjectState): MenuItem => ({
  label: 'Stop syncing this project',
  danger: true,
  confirm: STOP_SYNCING,
  onSelect: () => void act('setProjectHidden', project.id, true),
});

export const copyItem = (text: string, label = 'Copy link', what = 'Link'): MenuItem => ({ label, onSelect: () => copy(text, what) });

/** Shows the items as a native menu at the pointer and runs the one chosen. */
export function showContextMenu(event: MouseEvent, items: MenuItems): void {
  event.preventDefault();
  event.stopPropagation();
  const shown = items.filter((item): item is MenuItem => Boolean(item));
  // Destructive items get a line above them, as in Finder.
  void call(
    'contextMenu',
    shown.map((item, index) => ({ id: String(index), label: item.label, separatorBefore: item.danger === true && index > 0 })),
  ).then((chosen) => {
    const item = chosen === null ? undefined : shown[Number(chosen)];
    if (!item) return;
    if (item.confirm) ask({ sentence: item.confirm, label: item.label, danger: item.danger === true, onConfirm: item.onSelect, x: event.clientX, y: event.clientY });
    else item.onSelect();
  });
}
