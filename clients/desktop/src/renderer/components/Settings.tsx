import type { ReactNode } from 'react';
import type { AppState, NotifyKinds } from '../../shared/types.js';
import { platformWords } from '../../shared/platform.js';
import { act, ago } from '../api.js';
import { pluginSummary } from '../plugins.js';
import { ActionButton } from './ActionButton.js';
import { Setup } from './Setup.js';
import { Toolbar } from './Toolbar.js';

/** One setting: its name (and a note under it) on the left, its controls on the right. */
function Row({ label, note, children }: { label: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-label">
        <div>{label}</div>
        {note ? <div className="setting-note">{note}</div> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

/** An on/off switch: a styled checkbox, so keyboards and screen readers treat it as one. */
function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      <div className="settings-rows">{children}</div>
    </section>
  );
}

export function Settings({ state }: { state: AppState }) {
  const { settings, updates, app } = state;
  const hidden = state.projects.filter((project) => project.hidden);
  const checking = updates.kind === 'checking' || updates.kind === 'downloading';
  const words = platformWords(state.app.platform);
  const failed = state.setup.filter((step) => step.status === 'error');
  const needsRepair = failed.length > 0 || state.setup.some((step) => !step.optional && step.status === 'todo');

  const notifications: readonly [keyof NotifyKinds, string][] = [
    ['conflicts', 'A root file changes here and on gigacad.site at once'],
    ['approvals', 'A release request is waiting for my approval'],
    ['checkouts', `Someone checks out a branch I have on ${words.thisComputer}`],
    ['problems', 'Syncing has been failing for 5 minutes'],
  ];

  return (
    <>
      <Toolbar state={state} crumbs={[{ label: 'Settings' }]} />
      <div className="content settings">
        <div className="settings-column">
          {failed.length > 0 ? (
            <div className="notice is-error" role="alert">
              <div className="grow">A setup step failed: {failed.map((step) => step.title).join(', ')}.</div>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => document.getElementById('setup')?.scrollIntoView({ behavior: 'smooth' })}>
                Show
              </button>
            </div>
          ) : null}

          <Section title="Account">
            <Row
              label={
                <>
                  Signed in as <strong>@{state.user?.handle}</strong>
                </>
              }
              note={`The giga command line tool on ${words.thisComputer} uses the same sign-in.`}
            >
              <ActionButton
                small
                label="Sign Out"
                pending="Signing out…"
                confirm="Syncing stops until you sign in again. The giga command line tool is signed out too."
                run={() => act('signOut')}
              />
            </Row>
          </Section>

          <Section title="GigaCAD folder">
            <Row label={<span className="mono">{settings.folder}</span>} note="Your projects, as folders.">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('reveal', settings.folder)}>
                {words.showInFileManager}
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('chooseFolder')}>
                Change…
              </button>
            </Row>
          </Section>

          <Section title="Syncing">
            {settings.paused ? (
              <Row
                label="Paused"
                note={
                  settings.pausedUntil
                    ? `Until ${new Date(settings.pausedUntil).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
                    : 'Until you resume it'
                }
              >
                <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('setPaused', false)}>
                  Resume
                </button>
              </Row>
            ) : (
              <Row label="Pause syncing" note="Nothing uploads or downloads while paused.">
                <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('setPaused', true, 'hour')}>
                  For 1 hour
                </button>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('setPaused', true, 'tomorrow')}>
                  Until tomorrow
                </button>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('setPaused', true, null)}>
                  Until I resume
                </button>
              </Row>
            )}
            <Row label="Start GigaCAD when you log in">
              <Switch checked={settings.startAtLogin} label="Start GigaCAD when you log in" onChange={(on) => void act('updateSettings', { startAtLogin: on })} />
            </Row>
            {hidden.map((project) => (
              <Row key={project.id} label={`${project.owner}/${project.slug}`} note={`Not synced to ${words.thisComputer}`}>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('setProjectHidden', project.id, false)}>
                  Sync again
                </button>
              </Row>
            ))}
          </Section>

          <Section title="Notifications">
            <p className="settings-intro">While the GigaCAD window is closed, tell me when:</p>
            {notifications.map(([kind, label]) => (
              <Row key={kind} label={label}>
                <Switch checked={settings.notify[kind]} label={label} onChange={(on) => void act('setNotify', kind, on)} />
              </Row>
            ))}
          </Section>

          <Section title="Command line tool">
            {app.cliInstalled ? (
              <Row
                label={
                  <>
                    {words.terminal === 'Terminal' ? 'Terminal' : 'The terminal'} runs <span className="mono">giga</span>
                  </>
                }
                note={<span className="mono">{app.cliInstalled}</span>}
              />
            ) : (
              <Row label="giga isn’t installed" note={`Use giga in ${words.terminal} without installing Node.`}>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('installCli')}>
                  Install Command Line Tool…
                </button>
              </Row>
            )}
          </Section>

          {app.platform === 'win32' ? (
            <Section title="CAD programs">
              {state.plugins.map((plugin) => (
                <Row key={plugin.id} label={<strong>{plugin.name}</strong>} note={pluginSummary(plugin)}>
                  {plugin.addInsConnected > 0 ? <span className="dot dot-signal" title="Add-in connected" /> : null}
                </Row>
              ))}
              {state.plugins.length === 0 ? <Row label="None found" note="Repair looks for newly installed CAD programs." /> : null}
            </Section>
          ) : null}

          <Section title="Updates">
            <Row
              label={`Version ${app.version}${app.source === 'dev' ? ' (development)' : ''}`}
              note={
                <>
                  Last checked {ago(updates.lastChecked)}
                  {updates.kind === 'error' ? ` · Couldn’t reach the update server: ${updates.message}` : ''}
                  {updates.kind === 'ready' ? ` · Version ${updates.version} applies when GigaCAD restarts` : ''}
                </>
              }
            >
              <button type="button" className="btn btn-secondary btn-small" disabled={checking} onClick={() => void act('checkForUpdates')}>
                {checking ? 'Checking…' : 'Check for Updates'}
              </button>
            </Row>
          </Section>

          {/* Collapsed while everything passes; open when something needs fixing. */}
          <details className="settings-section repair" id="setup" open={needsRepair}>
            <summary>
              <h3>Repair</h3>
              <span className={`repair-state${needsRepair ? ' is-problem' : ''}`}>{needsRepair ? 'Needs attention' : 'Everything is set up'}</span>
            </summary>
            <p className="settings-intro">Checks the GigaCAD folder, {words.rightClickMenu}, gigacad:// links, and the rest of setup, and fixes what it can.</p>
            <Setup state={state} />
          </details>
        </div>
      </div>
    </>
  );
}
