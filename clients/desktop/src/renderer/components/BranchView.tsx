import { useEffect, useRef, useState } from 'react';
import type { AppState, BranchState, ProjectState } from '../../shared/types.js';
import { platformWords } from '../../shared/platform.js';
import { act, ago, call, toast, useLoad } from '../api.js';
import { groupHistory, type Commit } from '../history.js';
import { DownloadIcon, ExternalIcon, FolderIcon, LockIcon, SyncIcon } from '../icons.js';
import { branchUrl, commitUrl } from '../urls.js';
import { ActionButton } from './ActionButton.js';
import { MoreMenu } from './Menu.js';
import { Toolbar } from './Toolbar.js';

interface Props {
  readonly state: AppState;
  readonly project: ProjectState;
  readonly branch: BranchState;
  readonly focusCommit: boolean;
  readonly onOpenProject: () => void;
}

/** `giga status --json` for a branch workspace. */
interface Status {
  readonly remote: { readonly status: string; readonly behind: boolean } | null;
  readonly changes: readonly { readonly kind: 'added' | 'deleted' | 'modified' | 'moved'; readonly path: string; readonly from?: string }[];
}

export function BranchView({ state, project, branch, focusCommit, onOpenProject }: Props) {
  const words = platformWords(state.app.platform);
  const [tab, setTab] = useState<'changes' | 'history'>('changes');
  useEffect(() => {
    if (focusCommit) setTab('changes');
  }, [focusCommit]);
  const readOnly = project.role === 'viewer' || branch.status !== 'open';
  const url = branchUrl(state, project, branch.name);

  return (
    <>
      <Toolbar state={state} crumbs={[{ label: project.name, onClick: onOpenProject }, { label: branch.name }]} chip={<BranchChip project={project} branch={branch} />}>
        {branch.holder === 'me' ? (
          <ActionButton label="Check In" pending="Checking in…" done={`Checked in ${branch.name}`} busy={branch.busy} run={() => act('checkin', project.id, branch.name)} />
        ) : branch.holder === null && !readOnly ? (
          <ActionButton
            variant="primary"
            label="Check Out"
            pending="Checking out…"
            done={`Checked out ${branch.name}`}
            busy={branch.busy}
            run={() => act('checkout', project.id, branch.name)}
          />
        ) : !branch.downloaded ? (
          <ActionButton
            variant="primary"
            label="Download"
            pending="Downloading…"
            done={`Downloaded ${branch.name}`}
            icon={<DownloadIcon className="icon" />}
            busy={branch.busy}
            run={() => act('downloadBranch', project.id, branch.name)}
          />
        ) : null}
        {branch.downloaded ? (
          <>
            <ActionButton iconOnly label="Pull" pending="Pulling…" done={`Pulled ${branch.name}`} icon={<SyncIcon className="icon" />} busy={branch.busy} run={() => act('pull', project.id, branch.name)} />
            <button type="button" className="btn btn-secondary btn-icon" aria-label={words.showInFileManager} title={words.showInFileManager} onClick={() => void act('reveal', branch.dir)}>
              <FolderIcon className="icon" />
            </button>
          </>
        ) : null}
        <button type="button" className="btn btn-secondary btn-icon" aria-label="Open on gigacad.site" title="Open on gigacad.site" onClick={() => void act('openExternal', url)}>
          <ExternalIcon className="icon" />
        </button>
        <MoreMenu
          items={[
            { label: 'Copy link', onSelect: () => void act('copyText', url).then((ok) => ok && toast('Link copied')) },
            branch.downloaded && { label: `Open in ${words.terminal}`, onSelect: () => void act('openTerminal', branch.dir) },
            branch.downloaded &&
              branch.holder !== 'me' && {
                label: 'Remove download',
                onSelect: () => void act('removeBranch', project.id, branch.name).then((ok) => ok && toast(`Removed the download of ${branch.name}`)),
              },
            { label: 'Stop syncing this project', danger: true, onSelect: () => void act('setProjectHidden', project.id, true) },
          ]}
        />
      </Toolbar>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'changes'} className={`tab${tab === 'changes' ? ' is-active' : ''}`} onClick={() => setTab('changes')}>
          Changes
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={`tab${tab === 'history' ? ' is-active' : ''}`} onClick={() => setTab('history')}>
          History
        </button>
      </div>
      <div className="content">
        {!branch.downloaded ? (
          <NotDownloaded project={project} branch={branch} thisComputer={words.thisComputer} />
        ) : tab === 'changes' ? (
          <Changes project={project} branch={branch} focusCommit={focusCommit} thisComputer={words.thisComputer} />
        ) : (
          <History state={state} project={project} branch={branch} />
        )}
      </div>
    </>
  );
}

/** The branch's state next to its name: yours, someone else's, frozen for a release, or view only. */
function BranchChip({ project, branch }: { project: ProjectState; branch: BranchState }) {
  // A frozen branch belongs to a release request; find its number.
  const requests = useLoad(
    () => (branch.status === 'frozen' ? (call('releaseRequests', project.id) as Promise<{ number: number; branchName: string; status: string }[]>) : Promise.resolve([])),
    [project.id, branch.status],
  );
  if (branch.holder === 'me') {
    return (
      <span className="chip" title="Checked out on this computer">
        <span className="dot dot-signal" aria-hidden="true" />
        <span className="chip-label">Checked out</span>
      </span>
    );
  }
  if (branch.holder === 'other') {
    return (
      <span className="chip" title={`Checked out by @${branch.holderHandle} on ${branch.holderMachine}`}>
        <LockIcon className="icon icon-small" />
        <span className="chip-label">@{branch.holderHandle}</span>
      </span>
    );
  }
  if (branch.status === 'frozen') {
    const request = requests.data?.find((candidate) => candidate.branchName === branch.name && (candidate.status === 'open' || candidate.status === 'candidate'));
    return <span className="chip">{request ? `Frozen · request #${request.number}` : 'Frozen'}</span>;
  }
  if (branch.status !== 'open') return <span className="chip">{branch.status === 'released' ? 'Released' : 'Archived'}</span>;
  if (project.role === 'viewer') return <span className="chip">View only</span>;
  return null;
}

function NotDownloaded({ project, branch, thisComputer }: { project: ProjectState; branch: BranchState; thisComputer: string }) {
  return (
    <div className="panel">
      <div className="empty">
        <p>
          {branch.name} isn’t downloaded to {thisComputer}.
        </p>
        <ActionButton
          variant="primary"
          label="Download"
          pending="Downloading…"
          done={`Downloaded ${branch.name}`}
          icon={<DownloadIcon className="icon" />}
          busy={branch.busy}
          run={() => act('downloadBranch', project.id, branch.name)}
        />
      </div>
    </div>
  );
}

function Changes({ project, branch, focusCommit, thisComputer }: { project: ProjectState; branch: BranchState; focusCommit: boolean; thisComputer: string }) {
  const status = useLoad(() => call('branchStatus', project.id, branch.name) as Promise<Status>, [project.id, branch.name, branch.headCommitId, branch.busy]);
  const [message, setMessage] = useState('');
  const [label, setLabel] = useState('');
  const [committing, setCommitting] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusCommit) messageRef.current?.focus();
  }, [focusCommit]);
  // Saves become autosaves on their own; re-read the status when the window regains focus.
  useEffect(() => {
    const onFocus = () => status.reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  });

  const mine = branch.holder === 'me';
  const commit = async () => {
    setCommitting(true);
    const done = await act('commitVersion', project.id, branch.name, message.trim(), label.trim());
    setCommitting(false);
    if (done) {
      setMessage('');
      setLabel('');
      status.reload();
    }
  };

  const changes = status.data?.changes ?? [];
  return (
    <div className="split">
      <section className="panel">
        <div className="panel-head">
          Local changes
          <span className="faint">{mine ? 'Saves are autosaved after 5 seconds' : ''}</span>
          <button type="button" className="link push" onClick={status.reload}>
            Refresh
          </button>
        </div>
        {status.error ? (
          <div className="empty">
            {status.error.message}
            {status.error.hint ? <div>{status.error.hint}</div> : null}
          </div>
        ) : status.loading && !status.data ? (
          <div className="empty">Checking…</div>
        ) : changes.length === 0 ? (
          <div className="empty">
            No changes waiting.{' '}
            {status.data?.remote?.behind ? 'The branch has newer commits; pull to get them.' : mine ? 'Everything you saved is on gigacad.site.' : ''}
          </div>
        ) : (
          <ul className="rows">
            {changes.map((change) => (
              <li key={`${change.kind}:${change.path}`}>
                <span className={`badge badge-${change.kind}`}>{change.kind}</span>
                <span className="grow mono" title={change.from ? `${change.from} → ${change.path}` : change.path}>
                  {change.from ? `${change.from} → ${change.path}` : change.path}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">Commit a version</div>
        <form
          className="panel-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (message.trim()) void commit();
          }}
        >
          <label className="field">
            Message
            <textarea ref={messageRef} value={message} disabled={!mine} placeholder="What changed and why" onChange={(event) => setMessage(event.target.value)} />
          </label>
          <label className="field">
            <span>
              Label <span className="hint">optional, like v2 or “for print”</span>
            </span>
            <input value={label} disabled={!mine} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary wide" disabled={!mine || committing || !message.trim()}>
            {committing ? 'Committing…' : 'Commit Version'}
          </button>
          <p className="field-note">
            {mine ? 'A version replaces the autosaves since the last one.' : `Check out the branch to commit versions from ${thisComputer}.`}
          </p>
        </form>
      </section>
    </div>
  );
}

function History({ state, project, branch }: { state: AppState; project: ProjectState; branch: BranchState }) {
  const history = useLoad(() => call('branchHistory', project.id, branch.name) as Promise<Commit[]>, [project.id, branch.name, branch.headCommitId]);
  const [open, setOpen] = useState<string | null>(null);
  if (history.error) return <div className="panel empty">{history.error.message}</div>;
  if (!history.data) return <div className="panel empty">Loading…</div>;
  const rows = groupHistory(history.data);
  return (
    <section className="panel">
      <ul className="rows">
        {rows.map((row) =>
          row.version ? (
            <li key={row.key}>
              {row.version.versionLabel ? <span className="badge">{row.version.versionLabel}</span> : null}
              <span className="grow">{row.version.message || 'Version'}</span>
              <span className="faint">
                {row.version.authorHandle ? `@${row.version.authorHandle} · ` : ''}
                {ago(row.version.createdAt)}
              </span>
              <button type="button" className="link" onClick={() => void act('openExternal', commitUrl(state, project, row.version!.id))}>
                Open
              </button>
            </li>
          ) : (
            <li key={row.key} className="is-autosaves">
              <button type="button" className="link grow" aria-expanded={open === row.key} onClick={() => setOpen(open === row.key ? null : row.key)}>
                {row.autosaves!.length} {row.autosaves!.length === 1 ? 'autosave' : 'autosaves'}
              </button>
              <span className="faint">{ago(row.autosaves![0]!.createdAt)}</span>
              {open === row.key ? (
                <ul className="rows nested">
                  {row.autosaves!.map((commit) => (
                    <li key={commit.id}>
                      <span className="grow faint">{new Date(commit.createdAt).toLocaleString()}</span>
                      <button type="button" className="link" onClick={() => void act('openExternal', commitUrl(state, project, commit.id))}>
                        Open
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
