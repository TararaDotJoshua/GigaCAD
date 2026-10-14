// The actions for each kind of row, shared by its ⋯ menu and its right-click menu, so the two
// always offer the same things. Right-click menus are native (main/controller.ts contextMenu).
import type { MouseEvent } from 'react';
import { platformWords } from '../shared/platform.js';
import type { AppState, BranchState, ProjectState, ReleaseState } from '../shared/types.js';
import { act, call, toast } from './api.js';
import type { MenuItem } from './components/Menu.js';
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
    { label: 'Stop syncing this project', danger: true, onSelect: () => void act('setProjectHidden', project.id, true) },
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
        onSelect: () => void act('removeBranch', project.id, branch.name).then((ok) => ok && toast(`Removed the download of ${branch.name}`)),
      },
    { label: 'Stop syncing this project', danger: true, onSelect: () => void act('setProjectHidden', project.id, true) },
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
    if (chosen !== null) shown[Number(chosen)]?.onSelect();
  });
}
