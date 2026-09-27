import { useCallback, useState } from 'react';
import type { Navigate } from '../preload/index.js';
import type { AppState, BranchState, ProjectState } from '../shared/types.js';
import { useAppState, useNavigate } from './api.js';
import { BranchView } from './components/BranchView.js';
import { ProjectView } from './components/ProjectView.js';
import { Settings } from './components/Settings.js';
import { Setup } from './components/Setup.js';
import { Sidebar } from './components/Sidebar.js';
import { SignIn } from './components/SignIn.js';
import { Toasts } from './components/Toasts.js';

/** What the main column shows. */
export type Selection =
  | { readonly kind: 'project'; readonly projectId: string; readonly branch?: string | undefined; readonly commit?: boolean | undefined }
  | { readonly kind: 'settings' }
  | { readonly kind: 'none' };

export function App() {
  const state = useAppState();
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });

  // The menu (Settings…) and Quick Actions (Show in GigaCAD, Commit Version…) open views.
  useNavigate(
    useCallback((to: Navigate) => {
      if (to.projectId === 'settings') setSelection({ kind: 'settings' });
      else if (to.projectId) setSelection({ kind: 'project', projectId: to.projectId, branch: to.branch, commit: to.commit });
    }, []),
  );

  if (!state) return <div className="app-loading" />;
  if (!state.user) {
    return (
      <>
        <SignIn state={state} />
        <Toasts />
      </>
    );
  }
  if (!state.settings.setupDone) {
    return (
      <>
        <Setup state={state} firstRun />
        <Toasts />
      </>
    );
  }

  return (
    <div className="app">
      <Sidebar state={state} selection={selection} onSelect={setSelection} />
      <main className="main">{renderMain(state, selection, setSelection)}</main>
      <Toasts />
    </div>
  );
}

function renderMain(state: AppState, selection: Selection, select: (selection: Selection) => void) {
  if (selection.kind === 'settings') return <Settings state={state} />;
  const visible = state.projects.filter((project) => !project.hidden);
  const project: ProjectState | undefined =
    selection.kind === 'project' ? state.projects.find((candidate) => candidate.id === selection.projectId) : visible[0];
  if (!project) {
    return (
      <div className="center drag">
        <div className="empty">
          {state.sync.status === 'syncing' ? 'Looking for your projects…' : 'No projects yet. Create one on gigacad.site, or ask to be added to one.'}
        </div>
      </div>
    );
  }
  const branch: BranchState | undefined =
    selection.kind === 'project' && selection.branch ? project.branches.find((candidate) => candidate.name === selection.branch) : undefined;
  if (branch) {
    return <BranchView key={`${project.id}:${branch.name}`} state={state} project={project} branch={branch} focusCommit={selection.kind === 'project' && selection.commit === true} />;
  }
  return <ProjectView key={project.id} state={state} project={project} onOpenBranch={(name) => select({ kind: 'project', projectId: project.id, branch: name })} />;
}
