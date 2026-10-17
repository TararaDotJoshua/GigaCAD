// Pages on gigacad.site for the things the window shows (apps/web/app/(product)/[owner]/[project]).
import type { AppState, ProjectState } from '../shared/types.js';

const base = (state: AppState, project: ProjectState) => `${state.settings.appUrl}/${project.owner}/${project.slug}`;

export const projectUrl = (state: AppState, project: ProjectState) => base(state, project);
export const branchUrl = (state: AppState, project: ProjectState, branch: string) => `${base(state, project)}/branches/${encodeURIComponent(branch)}`;
export const releaseUrl = (state: AppState, project: ProjectState, number: number) => `${base(state, project)}/releases/${number}`;
export const requestUrl = (state: AppState, project: ProjectState, number: number) => `${base(state, project)}/release-requests/${number}`;
export const commitUrl = (state: AppState, project: ProjectState, id: string) => `${base(state, project)}/commits/${id}`;
