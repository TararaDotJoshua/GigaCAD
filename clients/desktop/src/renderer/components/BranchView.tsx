import { useEffect, useRef, useState } from 'react';
import type { AppState, BranchState, ProjectState } from '../../shared/types.js';
import { platformWords } from '../../shared/platform.js';
import { unreadErrors, useActivitySeenAt } from '../activity.js';
import { act, ago, call, toast, useLoad, useTicking } from '../api.js';
import { groupHistory, type Commit } from '../history.js';
import { DownloadIcon, ExternalIcon, FolderIcon, LockIcon, SyncIcon } from '../icons.js';
import { branchFolderUrl, branchUrl, commitUrl } from '../urls.js';
import { ActionButton } from './ActionButton.js';
import { ActivityList } from './Activity.js';
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
  const [tab, setTab] = useState<'changes' | 'history' | 'activity'>('changes');
  const seen = useActivitySeenAt();
  const activity = state.activity.filter((item) => item.projectId === project.id && item.branch === branch.name);
  const unread = unreadErrors(activity, seen).length;
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
        <button type="button" role="tab" aria-selected={tab === 'activity'} className={`tab${tab === 'activity' ? ' is-active' : ''}`} onClick={() => setTab('activity')}>
          Activity
          {unread > 0 ? <span className="dot dot-danger tab-dot" aria-label={`${unread} new`} /> : null}
        </button>
      </div>
      <div className="content">
        {tab === 'activity' ? (
          <section className="panel">
            <ActivityList state={state} items={activity} />
          </section>
        ) : tab === 'history' ? (
          <History state={state} project={project} branch={branch} />
        ) : !branch.downloaded ? (
          <NotDownloaded project={project} branch={branch} thisComputer={words.thisComputer} />
        ) : (
          <Changes state={state} project={project} branch={branch} focusCommit={focusCommit} />
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
          {branch.name} isn’t downloaded to {thisComputer}. Its history is on the History tab.
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

type Change = Status['changes'][number];

/** One letter per kind, in a fixed column, so file names line up. */
const KIND: Record<Change['kind'], { letter: string; label: string }> = {
  modified: { letter: 'M', label: 'Modified' },
  added: { letter: 'A', label: 'Added' },
  deleted: { letter: 'D', label: 'Deleted' },
  moved: { letter: 'R', label: 'Moved' },
};

/** A path with its folder dimmed and its name bright. */
function PathText({ path }: { path: string }) {
  const cut = path.lastIndexOf('/') + 1;
  return (
    <>
      <span className="faint">{path.slice(0, cut)}</span>
      {path.slice(cut)}
    </>
  );
}

function Changes({ state, project, branch, focusCommit }: { state: AppState; project: ProjectState; branch: BranchState; focusCommit: boolean }) {
  const words = platformWords(state.app.platform);
  const status = useLoad(() => call('branchStatus', project.id, branch.name) as Promise<Status>, [project.id, branch.name, branch.headCommitId, branch.busy]);
  // Saves become autosaves on their own; re-read the status when the window regains focus.
  useEffect(() => {
    const onFocus = () => status.reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  });

  const mine = branch.holder === 'me';
  const changes = status.data?.changes ?? [];
  const local = (path: string) => `${branch.dir}/${path}`;
  return (
    <div className="stack">
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
          <ul className="rows changes" aria-label="Changed files">
            {changes.map((change) => (
              <li
                key={`${change.kind}:${change.path}`}
                tabIndex={0}
                title={`${KIND[change.kind].label}. Click to show in ${words.fileManager}, double-click to open.`}
                onClick={() => change.kind !== 'deleted' && void act('reveal', local(change.path))}
                onDoubleClick={() => change.kind !== 'deleted' && void act('openPath', local(change.path))}
                onKeyDown={(event) => event.key === 'Enter' && change.kind !== 'deleted' && void act('openPath', local(change.path))}
              >
                <span className={`change-kind is-${change.kind}`} aria-label={KIND[change.kind].label}>
                  {KIND[change.kind].letter}
                </span>
                <span className="grow mono">
                  <PathText path={change.path} />
                  {change.from ? (
                    <span className="faint">
                      {' ← '}
                      {change.from}
                    </span>
                  ) : null}
                </span>
                <span className="row-actions" onClick={(event) => event.stopPropagation()}>
                  <MoreMenu
                    label={`More actions for ${change.path}`}
                    items={[
                      change.kind !== 'deleted' && { label: words.showInFileManager, onSelect: () => void act('reveal', local(change.path)) },
                      change.kind !== 'deleted' && { label: 'Open', onSelect: () => void act('openPath', local(change.path)) },
                      { label: 'Copy path', onSelect: () => void act('copyText', local(change.path)).then((ok) => ok && toast('Path copied')) },
                      { label: 'Open folder on gigacad.site', onSelect: () => void act('openExternal', branchFolderUrl(state, project, branch.name, change.path)) },
                    ]}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {mine ? (
        <CommitBox state={state} project={project} branch={branch} count={changes.length} focusCommit={focusCommit} onCommitted={status.reload} />
      ) : branch.holder === null && project.role !== 'viewer' && branch.status === 'open' ? (
        <div className="panel checkout-line">
          <span className="grow">
            Check out {branch.name} to commit versions from {words.thisComputer}.
          </span>
          <ActionButton
            variant="primary"
            small
            label="Check Out"
            pending="Checking out…"
            done={`Checked out ${branch.name}`}
            busy={branch.busy}
            run={() => act('checkout', project.id, branch.name)}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Under the changes: a message, an optional label, and Commit Version (Mod+Enter). */
function CommitBox({
  state,
  project,
  branch,
  count,
  focusCommit,
  onCommitted,
}: {
  state: AppState;
  project: ProjectState;
  branch: BranchState;
  count: number;
  focusCommit: boolean;
  onCommitted: () => void;
}) {
  const [message, setMessage] = useState('');
  const [label, setLabel] = useState('');
  const [committing, setCommitting] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusCommit) messageRef.current?.focus();
  }, [focusCommit]);
  const mac = state.app.platform !== 'win32';
  const commit = async () => {
    if (!message.trim() || committing) return;
    setCommitting(true);
    const done = await act('commitVersion', project.id, branch.name, message.trim(), label.trim());
    setCommitting(false);
    if (done) {
      toast(`Committed ${label.trim() ? `${label.trim()} ` : 'a version '}on ${branch.name}`);
      setMessage('');
      setLabel('');
      onCommitted();
    }
  };

  return (
    <form
      className="panel commit-box"
      aria-label="Commit a version"
      onSubmit={(event) => {
        event.preventDefault();
        void commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (mac ? event.metaKey : event.ctrlKey)) {
          event.preventDefault();
          void commit();
        }
      }}
    >
      <textarea ref={messageRef} value={message} aria-label="Message" placeholder="What changed and why" rows={2} onChange={(event) => setMessage(event.target.value)} />
      <div className="commit-row">
        <input value={label} aria-label="Label" placeholder="Label, optional: v2 or “for print”" onChange={(event) => setLabel(event.target.value)} />
        <button type="submit" className="btn btn-primary" title={`Commit Version (${mac ? '⌘' : 'Ctrl+'}Enter)`} disabled={committing || !message.trim()}>
          {committing ? 'Committing…' : count > 0 ? `Commit Version · ${count} ${count === 1 ? 'change' : 'changes'}` : 'Commit Version'}
        </button>
      </div>
      <p className="field-note">A version is permanent and replaces the autosaves since the last one.</p>
    </form>
  );
}

/** Versions as solid dots, autosave runs as hollow dashed ones that open. Works without a download. */
function History({ state, project, branch }: { state: AppState; project: ProjectState; branch: BranchState }) {
  useTicking();
  const history = useLoad(() => call('branchHistory', project.id, branch.name) as Promise<Commit[]>, [project.id, branch.name, branch.headCommitId]);
  const [open, setOpen] = useState<string | null>(null);
  if (history.error) return <div className="panel empty">{history.error.message}</div>;
  if (!history.data) return <div className="panel empty">Loading…</div>;
  if (history.data.length === 0) return <div className="panel empty">No commits yet.</div>;
  const rows = groupHistory(history.data);
  const links = (id: string, what: string) => (
    <MoreMenu
      label={`More actions for ${what}`}
      items={[
        { label: 'Open on gigacad.site', onSelect: () => void act('openExternal', commitUrl(state, project, id)) },
        { label: 'Copy link', onSelect: () => void act('copyText', commitUrl(state, project, id)).then((ok) => ok && toast('Link copied')) },
      ]}
    />
  );
  return (
    <section className="panel">
      <ol className="timeline">
        {rows.map((row) =>
          row.version ? (
            <li key={row.key} className="is-version">
              <span className="timeline-dot" aria-hidden="true" />
              <div className="grow">
                <div className="timeline-title">
                  {row.version.versionLabel ? <span className="badge">{row.version.versionLabel}</span> : null}
                  <span>{row.version.message || 'Version'}</span>
                </div>
                <div className="faint">
                  {row.version.authorHandle ? `@${row.version.authorHandle} · ` : ''}
                  <span title={new Date(row.version.createdAt).toLocaleString()}>{ago(row.version.createdAt)}</span>
                </div>
              </div>
              {links(row.version.id, row.version.message || 'this version')}
            </li>
          ) : (
            <li key={row.key} className="is-autosaves">
              <span className="timeline-dot" aria-hidden="true" />
              <div className="grow">
                <button type="button" className="link timeline-toggle" aria-expanded={open === row.key} onClick={() => setOpen(open === row.key ? null : row.key)}>
                  <span className="caret" aria-hidden="true">
                    ▸
                  </span>
                  {row.autosaves!.length} {row.autosaves!.length === 1 ? 'autosave' : 'autosaves'}
                  <span className="faint"> · {ago(row.autosaves![0]!.createdAt)}</span>
                </button>
                {open === row.key ? (
                  <ul className="rows nested">
                    {row.autosaves!.map((commit) => (
                      <li key={commit.id}>
                        <span className="grow faint">{new Date(commit.createdAt).toLocaleString()}</span>
                        {links(commit.id, 'this autosave')}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ),
        )}
      </ol>
    </section>
  );
}
