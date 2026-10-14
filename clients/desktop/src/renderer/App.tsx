import { useCallback, useEffect, useState } from 'react';
import type { Navigate } from '../preload/index.js';
import { platformWords } from '../shared/platform.js';
import type { AppState } from '../shared/types.js';
import { SelectContext } from './activity.js';
import { act, useAppState, useNavigate } from './api.js';
import { BranchView } from './components/BranchView.js';
import { ProjectView } from './components/ProjectView.js';
import { Settings } from './components/Settings.js';
import { Setup } from './components/Setup.js';
import { Sidebar } from './components/Sidebar.js';
import { SignIn } from './components/SignIn.js';
import { Toasts } from './components/Toasts.js';
import { Toolbar } from './components/Toolbar.js';
import { mainView, type Selection } from './view.js';

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

  // The title bar differs by system (styles.css): macOS's buttons sit left, Windows' right.
  const platform = state?.app.platform;
  useEffect(() => {
    if (platform) document.documentElement.dataset.platform = platform;
  }, [platform]);

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
    <SelectContext.Provider value={setSelection}>
      <div className="app">
        <Sidebar state={state} selection={selection} onSelect={setSelection} />
        <main className="main">{renderMain(state, selection, setSelection)}</main>
        <Toasts />
      </div>
    </SelectContext.Provider>
  );
}

function renderMain(state: AppState, selection: Selection, select: (selection: Selection) => void) {
  const view = mainView(state, selection);
  switch (view.kind) {
    case 'settings':
      return <Settings state={state} />;
    case 'empty':
      return (
        <div className="center drag">
          <div className="empty">
            {state.sync.status === 'syncing' ? 'Looking for your projects…' : 'No projects yet. Create one on gigacad.site, or ask to be added to one.'}
          </div>
        </div>
      );
    case 'hidden':
      return (
        <>
          <Toolbar state={state} crumbs={[{ label: view.project.owner }, { label: view.project.name }]} />
          <div className="center">
            <div className="empty">
              <p>Not synced to {platformWords(state.app.platform).thisComputer}</p>
              <button type="button" className="btn btn-primary" onClick={() => void act('setProjectHidden', view.project.id, false)}>
                Sync again
              </button>
            </div>
          </div>
        </>
      );
    case 'branch':
      return (
        <BranchView
          key={`${view.project.id}:${view.branch.name}`}
          state={state}
          project={view.project}
          branch={view.branch}
          focusCommit={view.focusCommit}
          onOpenProject={() => select({ kind: 'project', projectId: view.project.id })}
        />
      );
    case 'project':
      return <ProjectView key={view.project.id} state={state} project={view.project} onOpenBranch={(name) => select({ kind: 'project', projectId: view.project.id, branch: name })} />;
  }
}
