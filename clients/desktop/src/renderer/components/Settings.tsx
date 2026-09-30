import type { AppState } from '../../shared/types.js';
import { act, ago } from '../api.js';
import { Setup } from './Setup.js';
import { Toolbar } from './Toolbar.js';

export function Settings({ state }: { state: AppState }) {
  const { settings, updates, app } = state;
  const hidden = state.projects.filter((project) => project.hidden);
  const checking = updates.kind === 'checking' || updates.kind === 'downloading';

  return (
    <>
      <Toolbar state={state} eyebrow="GigaCAD" title="Settings" />
      <div className="content settings">
        <h3>Account</h3>
        <div className="inline">
          <span>
            Signed in as <strong>@{state.user?.handle}</strong> <span className="faint">({state.user?.apiUrl})</span>
          </span>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('signOut')}>
            Sign Out
          </button>
        </div>
        <p className="field-note">The giga command line tool on this Mac uses the same sign-in.</p>

        <h3>GigaCAD folder</h3>
        <div className="inline">
          <span className="mono">{settings.folder}</span>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('reveal', settings.folder)}>
            Show in Finder
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('chooseFolder')}>
            Change…
          </button>
        </div>

        <h3>Syncing</h3>
        <label className="check">
          <input type="checkbox" checked={settings.paused} onChange={(event) => void act('setPaused', event.target.checked)} />
          Pause syncing
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.startAtLogin} onChange={(event) => void act('updateSettings', { startAtLogin: event.target.checked })} />
          Start GigaCAD when you log in
        </label>
        {hidden.length > 0 ? (
          <>
            <p className="field-note">Not synced to this Mac:</p>
            <ul className="rows panel">
              {hidden.map((project) => (
                <li key={project.id}>
                  <span className="grow">
                    {project.owner}/{project.slug}
                  </span>
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('setProjectHidden', project.id, false)}>
                    Sync again
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <h3>Command line tool</h3>
        {app.cliInstalled ? (
          <p className="field-note">
            Terminal runs <span className="mono">giga</span> from <span className="mono">{app.cliInstalled}</span>.
          </p>
        ) : (
          <div className="inline">
            <span className="muted">Use giga in Terminal without installing Node.</span>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('installCli')}>
              Install Command Line Tool…
            </button>
          </div>
        )}

        <h3>Updates</h3>
        <div className="inline">
          <span>
            Version {app.version}
            {app.source === 'dev' ? ' (development)' : ''}
          </span>
          <button type="button" className="btn btn-secondary btn-small" disabled={checking} onClick={() => void act('checkForUpdates')}>
            {checking ? 'Checking…' : 'Check for Updates'}
          </button>
        </div>
        <p className="field-note">
          Last checked {ago(updates.lastChecked)}
          {updates.kind === 'error' ? ` · Couldn’t reach the update server: ${updates.message}` : ''}
          {updates.kind === 'ready' ? ` · Version ${updates.version} applies when GigaCAD restarts` : ''}
        </p>

        <h3>Repair</h3>
        <p className="field-note">Checks the GigaCAD folder, Finder’s Quick Actions, gigacad:// links, and the rest of setup, and fixes what it can.</p>
        <Setup state={state} />
      </div>
    </>
  );
}
