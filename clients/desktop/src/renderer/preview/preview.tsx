// The window in a browser, with a fake bridge in place of the preload script:
// `pnpm --filter @gigacad/desktop preview`, then /?fixture=branch-mine&platform=win32.
// Never part of the bundle: vite.config.ts builds only ../index.html.
import type { Bridge, Navigate } from '../../preload/index.js';
import type { AppState, CommandName, CommandResult } from '../../shared/types.js';
import { FIXTURES, SAMPLE_HISTORY, SAMPLE_REQUESTS, SAMPLE_ROOT_FILES, SAMPLE_STATUS } from './fixtures.js';

const params = new URLSearchParams(location.search);
const fixture = FIXTURES.find((candidate) => candidate.name === params.get('fixture')) ?? FIXTURES.find((candidate) => candidate.name === 'project')!;
const platform = params.get('platform') === 'win32' ? 'win32' : 'darwin';
let state: AppState = { ...fixture.state, app: { ...fixture.state.app, platform } };
const stateListeners = new Set<(state: AppState) => void>();

/** Commands that change the state do it here, so the preview behaves a little like the app. */
function run(name: CommandName, args: readonly unknown[]): unknown {
  switch (name) {
    case 'getState':
      return state;
    case 'branchStatus':
      return SAMPLE_STATUS;
    case 'branchHistory':
      return SAMPLE_HISTORY;
    case 'releaseRequests':
      return SAMPLE_REQUESTS;
    case 'rootFiles':
      return SAMPLE_ROOT_FILES;
    case 'contextMenu':
      // No native menus in a browser: log what it would offer.
      console.info('preview: context menu', (args[0] as { label: string }[]).map((item) => item.label).join(' · '));
      return null;
    case 'webUrl':
      return `${state.settings.appUrl}/${String(args[1] ?? '')}`;
    case 'setProjectHidden': {
      const [projectId, hidden] = args as [string, boolean];
      state = { ...state, projects: state.projects.map((project) => (project.id === projectId ? { ...project, hidden } : project)) };
      stateListeners.forEach((listener) => listener(state));
      return undefined;
    }
    default:
      console.info('preview: command', name, args);
      return undefined;
  }
}

const bridge: Bridge = {
  command: (name: CommandName, ...args: unknown[]): Promise<CommandResult<unknown>> => Promise.resolve({ ok: true, value: run(name, args) }),
  onState: (listener) => {
    stateListeners.add(listener);
    return () => void stateListeners.delete(listener);
  },
  onNavigate: (listener: (to: Navigate) => void) => {
    // After the first render, as the app does when the menu or a Quick Action opens a view.
    if (fixture.navigate) setTimeout(() => listener(fixture.navigate!), 0);
    return () => {};
  },
  onShortcut: () => () => {},
};

// Stand-ins for what the system draws over the window: macOS's traffic lights, and on
// Windows the 138 px of caption buttons over the toolbar's right end.
const chrome = document.createElement('style');
chrome.textContent = `
  body::after { content: ''; position: fixed; top: 0; z-index: 100; pointer-events: none; }
  [data-platform='darwin'] body::after { left: 20px; top: 20px; width: 52px; height: 12px;
    background: radial-gradient(circle 6px at 6px 6px, #ff5f57 98%, transparent) 0 0 / 20px 12px repeat-x; opacity: 0.85; }
  [data-platform='win32'] body::after { right: 0; width: 138px; height: 52px;
    background: repeating-linear-gradient(90deg, transparent 0 45px, rgb(245 245 247 / 0.08) 45px 46px), rgb(245 245 247 / 0.04); }
`;
document.head.append(chrome);
window.gigacad = bridge;
document.title = `GigaCAD preview · ${fixture.name}`;
await import('../main.js');
