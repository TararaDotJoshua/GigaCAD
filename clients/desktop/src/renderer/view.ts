import type { AppState, BranchState, ProjectState } from '../shared/types.js';

/** What the main column shows. */
export type Selection =
  | { readonly kind: 'project'; readonly projectId: string; readonly branch?: string | undefined; readonly commit?: boolean | undefined }
  | { readonly kind: 'settings' }
  | { readonly kind: 'none' };

export type MainView =
  | { readonly kind: 'settings' }
  | { readonly kind: 'empty' }
  /** A project that isn't synced to this computer: the window offers to sync it again. */
  | { readonly kind: 'hidden'; readonly project: ProjectState }
  | { readonly kind: 'project'; readonly project: ProjectState }
  | { readonly kind: 'branch'; readonly project: ProjectState; readonly branch: BranchState; readonly focusCommit: boolean };

/** Resolves a selection against the state. With nothing selected, the first synced project shows. */
export function mainView(state: AppState, selection: Selection): MainView {
  if (selection.kind === 'settings') return { kind: 'settings' };
  const project =
    selection.kind === 'project' ? state.projects.find((candidate) => candidate.id === selection.projectId) : state.projects.find((candidate) => !candidate.hidden);
  if (!project) return { kind: 'empty' };
  if (project.hidden) return { kind: 'hidden', project };
  const branch = selection.kind === 'project' && selection.branch ? project.branches.find((candidate) => candidate.name === selection.branch) : undefined;
  if (branch) return { kind: 'branch', project, branch, focusCommit: selection.kind === 'project' && selection.commit === true };
  return { kind: 'project', project };
}
