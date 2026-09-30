import { useState } from 'react';
import { SyncIcon } from '../icons.js';
import { act } from '../api.js';
import { bannerFor } from '../banner.js';
import type { AppState } from '../../shared/types.js';

/** Pinned above the account row; appears only when there's an update or a rollback to mention. */
export function UpdateBanner({ state }: { state: AppState }) {
  const [showNotes, setShowNotes] = useState(false);
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
    return (
      <div className="update" role="status">
        <div className="update-row">
          <SyncIcon className="icon" />
          <div>
            <div className="update-title">The last update didn’t start</div>
            <div className="update-sub">GigaCAD went back to v{state.app.version}. v{banner.version} won’t be tried again.</div>
          </div>
        </div>
        <div className="update-actions">
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('dismissRollback')}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  const reinstall = banner.kind === 'reinstall';
  return (
    <div className="update" role="status">
      <div className="update-row">
        <SyncIcon className="icon" />
        <div>
          <div className="update-title">{reinstall ? 'New version available' : 'Update ready'}</div>
          <div className="update-sub">
            {reinstall ? (
              'Needs a fresh download'
            ) : (
              <>
                v{banner.version}
                {banner.notes || banner.notesUrl ? (
                  <>
                    {' · '}
                    <button type="button" className="link" aria-expanded={showNotes} onClick={() => (banner.notes ? setShowNotes(!showNotes) : void act('openExternal', banner.notesUrl!))}>
                      What’s new
                    </button>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
        <button type="button" className="update-close" aria-label="Hide until the next version" onClick={() => void act('dismissUpdate')}>
          ×
        </button>
      </div>
      {showNotes && banner.kind === 'ready' ? <div className="notes">{banner.notes}</div> : null}
      <div className="update-actions">
        {reinstall ? (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('openExternal', banner.downloadUrl)}>
            Download
          </button>
        ) : (
          <button type="button" className="btn btn-secondary btn-small" disabled={banner.restarting} onClick={() => void act('restartToUpdate')}>
            {banner.restarting ? 'Restarting after sync…' : 'Restart'}
          </button>
        )}
      </div>
    </div>
  );
}
