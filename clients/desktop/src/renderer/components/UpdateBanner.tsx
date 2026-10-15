import { useEffect, useState } from 'react';
import { SyncIcon } from '../icons.js';
import { act } from '../api.js';
import { bannerFor } from '../banner.js';
import type { AppState } from '../../shared/types.js';

/** Below this window height the banner shrinks to one line, so the project list keeps its room. */
const SHORT_WINDOW = '(max-height: 639px)';

function useShortWindow(): boolean {
  const [short, setShort] = useState(() => window.matchMedia(SHORT_WINDOW).matches);
  useEffect(() => {
    const query = window.matchMedia(SHORT_WINDOW);
    const onChange = () => setShort(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return short;
}

/** Pinned above the account row; appears only when there's an update or a rollback to mention. */
export function UpdateBanner({ state }: { state: AppState }) {
  const [showNotes, setShowNotes] = useState(false);
  const short = useShortWindow();
  const banner = bannerFor(state.updates, state.settings.dismissedUpdate, state.rolledBackFrom);
  if (!banner) return null;

  if (banner.kind === 'downloading') {
    return (
      <div className="update-quiet" role="status">
        Downloading update… {banner.percent}%
        <div className="progress" aria-hidden="true">
          <div style={{ width: `${banner.percent}%` }} />
        </div>
      </div>
    );
  }

  if (banner.kind === 'rollback') {
    const detail = `GigaCAD went back to v${state.app.version}. v${banner.version} won’t be tried again.`;
    const dismiss = (
      <button type="button" className={short ? 'link' : 'btn btn-secondary btn-small'} onClick={() => void act('dismissRollback')}>
        Dismiss
      </button>
    );
    if (short) {
      return (
        <div className="update is-short" role="status" title={detail}>
          <SyncIcon className="icon" />
          <span className="update-title grow">Update didn’t start</span>
          {dismiss}
        </div>
      );
    }
    return (
      <div className="update" role="status">
        <div className="update-row">
          <SyncIcon className="icon" />
          <div>
            <div className="update-title">The last update didn’t start</div>
            <div className="update-sub">{detail}</div>
          </div>
        </div>
        <div className="update-actions">{dismiss}</div>
      </div>
    );
  }

  const reinstall = banner.kind === 'reinstall';
  const title = reinstall ? 'New version available' : 'Update ready';
  const action = reinstall ? (
    <button type="button" className={short ? 'link' : 'btn btn-secondary btn-small'} onClick={() => void act('openExternal', banner.downloadUrl)}>
      Download
    </button>
  ) : (
    <button type="button" className={short ? 'link' : 'btn btn-secondary btn-small'} disabled={banner.restarting} onClick={() => void act('restartToUpdate')}>
      {banner.restarting ? (short ? 'Restarting…' : 'Restarting after sync…') : 'Restart'}
    </button>
  );
  const close = (
    <button type="button" className="update-close" aria-label="Hide until the next version" onClick={() => void act('dismissUpdate')}>
      ×
    </button>
  );
  const notes = banner.kind === 'ready' && banner.notes ? banner.notes : null;
  const notesUrl = banner.kind === 'ready' ? banner.notesUrl : null;
  // Notes open in place; a release with only a link opens it in the browser.
  const toggleNotes = notes ? () => setShowNotes(!showNotes) : notesUrl ? () => void act('openExternal', notesUrl) : null;

  if (short) {
    // One line: "Update ready · Restart", with the notes in a popover above it.
    return (
      <div className="update is-short" role="status">
        <SyncIcon className="icon" />
        <span className="update-title grow" title={reinstall ? 'Needs a fresh download' : `v${banner.version}`}>
          {title}
        </span>
        {action}
        {toggleNotes ? (
          <>
            <span className="update-sub">·</span>
            <button type="button" className="link" aria-expanded={showNotes} aria-label="What’s new" onClick={toggleNotes}>
              Notes
            </button>
          </>
        ) : null}
        {close}
        {showNotes && notes ? <div className="notes is-popover">{notes}</div> : null}
      </div>
    );
  }

  return (
    <div className="update" role="status">
      <div className="update-row">
        <SyncIcon className="icon" />
        <div>
          <div className="update-title">{title}</div>
          <div className="update-sub">
            {reinstall ? (
              'Needs a fresh download'
            ) : (
              <>
                v{banner.version}
                {toggleNotes ? (
                  <>
                    {' · '}
                    <button type="button" className="link" aria-expanded={showNotes} onClick={toggleNotes}>
                      What’s new
                    </button>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
        {close}
      </div>
      {showNotes && notes ? <div className="notes">{notes}</div> : null}
      <div className="update-actions">{action}</div>
    </div>
  );
}
