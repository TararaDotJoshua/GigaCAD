import { useEffect, useRef, useState } from 'react';
import type { AppState, BranchState, ProjectState } from '../../shared/types.js';
import { act, ago, call, useLoad } from '../api.js';
import { groupHistory, type Commit } from '../history.js';
import { DownloadIcon, FolderIcon, LockIcon, SyncIcon } from '../icons.js';
import { Toolbar } from './Toolbar.js';

interface Props {
  readonly state: AppState;
  readonly project: ProjectState;
  readonly branch: BranchState;
  readonly focusCommit: boolean;
}

/** `giga status --json` for a branch workspace. */
interface Status {
  readonly remote: { readonly status: string; readonly behind: boolean } | null;
  readonly changes: readonly { readonly kind: 'added' | 'deleted' | 'modified' | 'moved'; readonly path: string; readonly from?: string }[];
}

export function BranchView({ state, project, branch, focusCommit }: Props) {
  const [tab, setTab] = useState<'changes' | 'history'>('changes');
  useEffect(() => {
    if (focusCommit) setTab('changes');
  }, [focusCommit]);
  const readOnly = project.role === 'viewer' || branch.status !== 'open';

  return (
    <>
      <Toolbar state={state} eyebrow={`${project.owner}/${project.slug}`} title={branch.name}>
        {branch.holder === 'me' ? (
          <button type="button" className="btn btn-secondary" disabled={branch.busy} onClick={() => void act('checkin', project.id, branch.name)}>
            Check In
          </button>
        ) : branch.holder === 'other' ? (
          <span className="badge" title={`On ${branch.holderMachine}`}>
            <LockIcon className="icon icon-small" />
            Held by @{branch.holderHandle}
          </span>
        ) : readOnly ? (
          <span className="badge">{branch.status === 'open' ? 'View only' : branch.status}</span>
        ) : (
          <button type="button" className="btn btn-primary" disabled={branch.busy} onClick={() => void act('checkout', project.id, branch.name)}>
            Check Out
          </button>
        )}
        {branch.downloaded ? (
          <>
            <button type="button" className="btn btn-secondary" disabled={branch.busy} onClick={() => void act('pull', project.id, branch.name)}>
              <SyncIcon className="icon" />
              Pull
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void act('reveal', branch.dir)}>
              <FolderIcon className="icon" />
              Show in Finder
            </button>
          </>
        ) : null}
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
          <NotDownloaded project={project} branch={branch} />
        ) : tab === 'changes' ? (
          <Changes project={project} branch={branch} focusCommit={focusCommit} />
        ) : (
          <History state={state} project={project} branch={branch} />
        )}
      </div>
    </>
  );
}

function NotDownloaded({ project, branch }: { project: ProjectState; branch: BranchState }) {
  return (
    <div className="panel">
      <div className="empty">
        <p>{branch.name} isn’t downloaded to this Mac.</p>
        <button type="button" className="btn btn-primary" disabled={branch.busy} onClick={() => void act('downloadBranch', project.id, branch.name)}>
          <DownloadIcon className="icon" />
          Download
        </button>
      </div>
    </div>
  );
}

function Changes({ project, branch, focusCommit }: { project: ProjectState; branch: BranchState; focusCommit: boolean }) {
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
            {mine ? 'A version replaces the autosaves since the last one.' : 'Check out the branch to commit versions from this Mac.'}
          </p>
        </form>
      </section>
    </div>
  );
}

function History({ state, project, branch }: { state: AppState; project: ProjectState; branch: BranchState }) {
  const history = useLoad(() => call('branchHistory', project.id, branch.name) as Promise<Commit[]>, [project.id, branch.name, branch.headCommitId]);
  const [open, setOpen] = useState<string | null>(null);
  const commitUrl = (id: string) => `${state.settings.appUrl}/${project.owner}/${project.slug}/commits/${id}`;
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
              <button type="button" className="link" onClick={() => void act('openExternal', commitUrl(row.version!.id))}>
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
                      <button type="button" className="link" onClick={() => void act('openExternal', commitUrl(commit.id))}>
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
