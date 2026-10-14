import { branchNameProblem } from '@gigacad/core';
import { useEffect, useRef, useState } from 'react';
import type { AppState, BranchState, ProjectState, ReleaseState, ReleasesToKeep } from '../../shared/types.js';
import { platformWords } from '../../shared/platform.js';
import { act, ago, call, toast, useLoad } from '../api.js';
import { BranchIcon, DownloadIcon, ExternalIcon, FileIcon, FolderIcon, LockIcon, MergeIcon, PlusIcon } from '../icons.js';
import { branchItems, copyItem, releaseItems, showContextMenu } from '../menus.js';
import { useSavedTab } from '../navigation.js';
import { projectUrl, releaseUrl, requestUrl } from '../urls.js';
import { ActionButton } from './ActionButton.js';
import { MoreMenu } from './Menu.js';
import { Tabs } from './Tabs.js';
import { Toolbar } from './Toolbar.js';

interface Props {
  readonly state: AppState;
  readonly project: ProjectState;
  readonly onOpenBranch: (name: string) => void;
}

interface RequestSummary {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly status: 'open' | 'candidate' | 'released' | 'closed';
  readonly branchName: string;
  readonly requesterHandle: string | null;
  readonly updatedAt: string;
}

type Tab = 'branches' | 'releases' | 'requests' | 'files';

const canEdit = (project: ProjectState) => project.role !== null && project.role !== 'viewer';
/** Candidates wait for approvals; anyone who can edit may be an approver. */
const needsYou = (project: ProjectState, requests: readonly RequestSummary[] | undefined) =>
  canEdit(project) ? (requests ?? []).filter((request) => request.status === 'candidate') : [];

export function ProjectView({ state, project, onOpenBranch }: Props) {
  const words = platformWords(state.app.platform);
  const [tab, setTab] = useSavedTab<Tab>('project', ['branches', 'releases', 'requests', 'files'], 'branches');
  const [creating, setCreating] = useState(false);
  const url = projectUrl(state, project);

  // Release requests change when branches freeze or releases go out: reload then, and on focus.
  const head = `${project.releases[0]?.number ?? 0}:${project.branches.map((branch) => `${branch.name}=${branch.status}`).join(',')}`;
  const requests = useLoad(() => call('releaseRequests', project.id) as Promise<RequestSummary[]>, [project.id, head]);
  useEffect(() => {
    const onFocus = () => requests.reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  });
  const waiting = needsYou(project, requests.data);
  const openRequests = (requests.data ?? []).filter((request) => request.status === 'open' || request.status === 'candidate');

  const tabs: { id: Tab; label: string; count?: number; caution?: boolean }[] = [
    { id: 'branches', label: 'Branches', count: project.branches.length },
    { id: 'releases', label: 'Releases', count: project.releases.length },
    { id: 'requests', label: 'Release requests', count: openRequests.length, caution: waiting.length > 0 },
    { id: 'files', label: 'Root files' },
  ];

  return (
    <>
      <Toolbar state={state} crumbs={[{ label: project.owner }, { label: project.name }]} chip={project.role === 'viewer' ? <span className="chip">View only</span> : null}>
        {canEdit(project) ? (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <PlusIcon className="icon" />
            <span className="btn-label">New Branch</span>
          </button>
        ) : null}
        <button type="button" className="btn btn-secondary btn-icon" aria-label={words.showInFileManager} title={words.showInFileManager} onClick={() => void act('reveal', project.dir)}>
          <FolderIcon className="icon" />
        </button>
        <button type="button" className="btn btn-secondary btn-icon" aria-label="Open on gigacad.site" title="Open on gigacad.site" onClick={() => void act('openExternal', url)}>
          <ExternalIcon className="icon" />
        </button>
        <MoreMenu
          items={[
            { label: 'Copy link', onSelect: () => void act('copyText', url).then((ok) => ok && toast('Link copied')) },
            { label: `Open in ${words.terminal}`, onSelect: () => void act('openTerminal', project.dir) },
            { label: 'Stop syncing this project', danger: true, onSelect: () => void act('setProjectHidden', project.id, true) },
          ]}
        />
      </Toolbar>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={tabs.map((item) => ({
          id: item.id,
          label: (
            <>
              {item.label}
              {item.count !== undefined && item.count > 0 ? (
                <span className={`count${item.caution ? ' is-caution' : ''}`} title={item.caution ? 'Waiting for your approval' : undefined}>
                  {item.count}
                </span>
              ) : null}
            </>
          ),
        }))}
      >
        {project.error ? <div className="notice is-error">{project.error}</div> : null}
        {project.conflicts.map((conflict) => (
          <div key={conflict.path} className="notice is-caution" role="alert">
            <div className="grow">
              <strong>{conflict.path}</strong> changed here and on gigacad.site. The site’s version is in place; yours is kept as <strong>{conflict.copy}</strong>.
            </div>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('reveal', `${project.dir}/${conflict.copy}`)}>
              Show both
            </button>
            <button type="button" className="link" onClick={() => void act('dismissConflict', project.id, conflict.path)}>
              Dismiss
            </button>
          </div>
        ))}
        {tab === 'branches' ? (
          <BranchesTab
            state={state}
            project={project}
            onOpenBranch={onOpenBranch}
            waiting={waiting}
            onApproved={requests.reload}
            onNewBranch={() => setCreating(true)}
            onShowReleases={() => setTab('releases')}
          />
        ) : tab === 'releases' ? (
          <ReleasesTab state={state} project={project} />
        ) : tab === 'requests' ? (
          <RequestsTab state={state} project={project} requests={requests} />
        ) : (
          <RootFilesTab state={state} project={project} />
        )}
      </Tabs>
      {creating ? <NewBranchSheet project={project} onClose={() => setCreating(false)} onCreated={onOpenBranch} /> : null}
    </>
  );
}

// --- Branches ----------------------------------------------------------------------------

function BranchesTab({
  state,
  project,
  onOpenBranch,
  waiting,
  onApproved,
  onNewBranch,
  onShowReleases,
}: Props & { waiting: readonly RequestSummary[]; onApproved: () => void; onNewBranch: () => void; onShowReleases: () => void }) {
  const words = platformWords(state.app.platform);
  const latest = project.releases[0];
  return (
    <>
      {waiting.length > 0 ? (
        <section className="panel needs-you">
          <div className="panel-head">
            <MergeIcon className="icon" />
            Needs you
          </div>
          <ul className="rows">
            {waiting.map((request) => (
              <li key={request.id}>
                <span className="faint mono">#{request.number}</span>
                <span className="grow">
                  {request.title}
                  <span className="faint"> · {request.branchName}</span>
                </span>
                <button type="button" className="link" onClick={() => void act('openExternal', requestUrl(state, project, request.number))}>
                  Review
                </button>
                <ActionButton
                  small
                  label="Approve"
                  pending="Approving…"
                  done={`Approved #${request.number}`}
                  confirm={`Approve #${request.number}? The release goes out when the last approval is in.`}
                  run={async () => {
                    const ok = await act('approveReleaseRequest', project.id, request.number);
                    if (ok) onApproved();
                    return ok;
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel">
        {project.branches.length === 0 ? (
          <div className="empty">
            <p>No branches yet.</p>
            {canEdit(project) ? (
              <button type="button" className="btn btn-primary" onClick={onNewBranch}>
                <PlusIcon className="icon" />
                New Branch
              </button>
            ) : null}
          </div>
        ) : (
          <div className="table" role="table" aria-label="Branches">
            <div className="table-head" role="row">
              <span role="columnheader">Branch</span>
              <span role="columnheader">State</span>
              <span role="columnheader">On {words.thisComputer}</span>
              <span role="columnheader" className="sr-only">
                Actions
              </span>
            </div>
            {project.branches.map((branch) => (
              <BranchRow key={branch.id} state={state} project={project} branch={branch} onOpen={() => onOpenBranch(branch.name)} />
            ))}
          </div>
        )}
      </section>

      {latest ? (
        <section className="panel gap latest-release">
          <div className="panel-head">
            <LockIcon className="icon" />
            Latest release
            <button type="button" className="link push" onClick={onShowReleases}>
              All releases
            </button>
          </div>
          <ul className="rows">
            <ReleaseRow state={state} project={project} release={latest} />
          </ul>
        </section>
      ) : null}
    </>
  );
}

function BranchRow({ state, project, branch, onOpen }: { state: AppState; project: ProjectState; branch: BranchState; onOpen: () => void }) {
  return (
    // The row opens the branch; its buttons stop the click from doing that too.
    <div
      className="table-row"
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onContextMenu={(event) => showContextMenu(event, branchItems(state, project, branch))}
      onKeyDown={(event) => event.key === 'Enter' && event.target === event.currentTarget && onOpen()}>
      <span role="cell" className="strong cell-name" title={branch.name}>
        <BranchIcon className="icon faint" />
        {branch.name}
      </span>
      <span role="cell" className="cell-state">
        <BranchStateText branch={branch} />
      </span>
      <span role="cell" className="faint">
        {branch.busy ? 'Working…' : branch.downloaded ? 'Downloaded' : '—'}
      </span>
      <span role="cell" className="cell-actions" onClick={(event) => event.stopPropagation()}>
        {branch.downloaded ? (
          <button type="button" className="btn btn-secondary btn-small" onClick={onOpen}>
            Open
          </button>
        ) : (
          <ActionButton
            small
            label="Download"
            pending="Downloading…"
            done={`Downloaded ${branch.name}`}
            icon={<DownloadIcon className="icon" />}
            busy={branch.busy}
            run={() => act('downloadBranch', project.id, branch.name)}
          />
        )}
        <MoreMenu label={`More actions for ${branch.name}`} items={branchItems(state, project, branch)} />
      </span>
    </div>
  );
}

/** "Checked out by you", "🔒 @sam · Sam's PC", "Frozen", or "Available". */
function BranchStateText({ branch }: { branch: BranchState }) {
  if (branch.holder === 'me') {
    return (
      <span className="state">
        <span className="dot dot-signal" aria-hidden="true" />
        Checked out by you
      </span>
    );
  }
  if (branch.holder === 'other') {
    return (
      <span className="state" title={`Checked out by @${branch.holderHandle} on ${branch.holderMachine}`}>
        <LockIcon className="icon icon-small" />@{branch.holderHandle}
        {branch.holderMachine ? <span className="faint"> · {branch.holderMachine}</span> : null}
      </span>
    );
  }
  if (branch.status === 'frozen') return <span className="state">Frozen for a release</span>;
  if (branch.status !== 'open') return <span className="state faint">{branch.status === 'released' ? 'Released' : 'Archived'}</span>;
  return <span className="state faint">Available</span>;
}

// --- Releases ----------------------------------------------------------------------------

function ReleasesTab({ state, project }: { state: AppState; project: ProjectState }) {
  const words = platformWords(state.app.platform);
  const keep: ReleasesToKeep = state.settings.releases[project.id] ?? 'latest';
  return (
    <section className="panel">
      <div className="panel-head">
        <LockIcon className="icon" />
        Releases
        <label className="push inline faint">
          Keep on {words.thisComputer}
          <select className="select" value={keep} onChange={(event) => void act('setReleasesToKeep', project.id, event.target.value as ReleasesToKeep)}>
            <option value="latest">Latest</option>
            <option value="all">All</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
      {project.releases.length === 0 ? (
        <div className="empty">No releases yet. A release request on gigacad.site makes the first one.</div>
      ) : (
        <ul className="rows releases">
          {project.releases.map((release) => (
            <ReleaseRow key={release.number} state={state} project={project} release={release} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReleaseRow({ state, project, release }: { state: AppState; project: ProjectState; release: ReleaseState }) {
  const words = platformWords(state.app.platform);
  return (
    <li onContextMenu={(event) => showContextMenu(event, releaseItems(state, project, release))}>
      <span className="strong mono">v{release.number}</span>
      <span className="grow" title={release.notes || undefined}>
        {release.title ?? `Release ${release.number}`}
        {release.notes ? <span className="faint"> · {release.notes}</span> : null}
      </span>
      <span className="faint" title={new Date(release.createdAt).toLocaleString()}>
        {ago(release.createdAt)}
      </span>
      {release.downloaded ? (
        <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('reveal', release.dir)}>
          {words.showInFileManager}
        </button>
      ) : (
        <ActionButton
          small
          label="Download"
          pending="Downloading…"
          done={`Downloaded v${release.number}`}
          icon={<DownloadIcon className="icon" />}
          run={() => act('downloadRelease', project.id, release.number)}
        />
      )}
      <button
        type="button"
        className="btn btn-secondary btn-small btn-icon"
        aria-label={`Open v${release.number} on gigacad.site`}
        title="Open on gigacad.site"
        onClick={() => void act('openExternal', releaseUrl(state, project, release.number))}
      >
        <ExternalIcon className="icon" />
      </button>
    </li>
  );
}

// --- Release requests --------------------------------------------------------------------

function RequestsTab({ state, project, requests }: { state: AppState; project: ProjectState; requests: ReturnType<typeof useLoad<RequestSummary[]>> }) {
  const openable = project.branches.filter((branch) => branch.status === 'open');
  const [branch, setBranch] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [opening, setOpening] = useState(false);
  const chosen = branch || openable[0]?.name || '';

  const open = async () => {
    setOpening(true);
    const done = await act('openReleaseRequest', project.id, chosen, title.trim(), body.trim());
    setOpening(false);
    if (done) {
      setTitle('');
      setBody('');
      requests.reload();
    }
  };

  return (
    <div className="split">
      <section className="panel">
        <div className="panel-head">
          <MergeIcon className="icon" />
          Release requests
          <button type="button" className="link push" onClick={requests.reload}>
            Refresh
          </button>
        </div>
        {requests.error ? (
          <div className="empty">{requests.error.message}</div>
        ) : !requests.data ? (
          <div className="empty">Loading…</div>
        ) : requests.data.length === 0 ? (
          <div className="empty">No release requests yet.</div>
        ) : (
          <ul className="rows">
            {requests.data.map((request) => (
              <li key={request.id}>
                <span className="faint mono">#{request.number}</span>
                <span className="grow">
                  {request.title}
                  <span className="faint"> · {request.branchName}</span>
                </span>
                <span className={`badge${request.status === 'candidate' ? ' badge-caution' : ''}`}>{request.status === 'candidate' ? 'awaiting approval' : request.status}</span>
                {request.status === 'candidate' && canEdit(project) ? (
                  <ActionButton
                    small
                    label="Approve"
                    pending="Approving…"
                    done={`Approved #${request.number}`}
                    confirm={`Approve #${request.number}? The release goes out when the last approval is in.`}
                    run={async () => {
                      const ok = await act('approveReleaseRequest', project.id, request.number);
                      if (ok) requests.reload();
                      return ok;
                    }}
                  />
                ) : null}
                <button type="button" className="link" onClick={() => void act('openExternal', requestUrl(state, project, request.number))}>
                  Review
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canEdit(project) ? (
        <section className="panel">
          <div className="panel-head">Open a release request</div>
          <form
            className="panel-body"
            onSubmit={(event) => {
              event.preventDefault();
              if (chosen) void open();
            }}
          >
            <label className="field">
              Branch
              <select value={chosen} onChange={(event) => setBranch(event.target.value)}>
                {openable.map((candidate) => (
                  <option key={candidate.id} value={candidate.name}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Title <input value={title} placeholder={chosen ? `Release ${chosen}` : ''} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="field">
              Description <textarea value={body} onChange={(event) => setBody(event.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary wide" disabled={opening || !chosen}>
              {opening ? 'Opening…' : 'Open request'}
            </button>
            <p className="field-note">The branch freezes until the request is released or closed. Choosing what goes into the release happens on gigacad.site.</p>
          </form>
        </section>
      ) : null}
    </div>
  );
}

// --- Root files --------------------------------------------------------------------------

interface RootFile {
  readonly entryId: string;
  readonly name: string;
  readonly path: string;
  readonly revision: number | null;
  readonly modifiedAt: string;
  readonly modifiedByHandle: string | null;
}

function RootFilesTab({ state, project }: { state: AppState; project: ProjectState }) {
  const words = platformWords(state.app.platform);
  const files = useLoad(() => call('rootFiles', project.id) as Promise<{ entries: RootFile[] }>, [project.id]);
  return (
    <section className="panel">
      <div className="panel-head">
        <FileIcon className="icon" />
        Recently changed root files
        <button type="button" className="link push" onClick={files.reload}>
          Refresh
        </button>
      </div>
      {files.error ? (
        <div className="empty">{files.error.message}</div>
      ) : !files.data ? (
        <div className="empty">Loading…</div>
      ) : files.data.entries.length === 0 ? (
        <div className="empty">No root files yet. Files you put in the project folder, outside Branches and Releases, sync both ways and show up here.</div>
      ) : (
        <ul className="rows">
          {files.data.entries.map((file) => {
            const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : '';
            const local = `${project.dir}/${file.path}`;
            const web = `${projectUrl(state, project)}/entries/${file.entryId}`;
            return (
              <li
                key={file.entryId}
                onContextMenu={(event) =>
                  showContextMenu(event, [
                    { label: words.showInFileManager, onSelect: () => void act('reveal', local) },
                    { label: 'Open', onSelect: () => void act('openPath', local) },
                    copyItem(local, 'Copy path', 'Path'),
                    { label: 'Open on gigacad.site', onSelect: () => void act('openExternal', web) },
                    copyItem(web),
                  ])
                }
                onDoubleClick={() => void act('openPath', local)}
              >
                <span className="grow mono" title={file.path}>
                  <span className="faint">{folder}</span>
                  {file.name}
                </span>
                <span className="faint">{file.revision ? `rev ${file.revision}` : ''}</span>
                <span className="faint" title={new Date(file.modifiedAt).toLocaleString()}>
                  {file.modifiedByHandle ? `@${file.modifiedByHandle} · ` : ''}
                  {ago(file.modifiedAt)}
                </span>
                <button type="button" className="btn btn-secondary btn-small" title={words.showInFileManager} onClick={() => void act('reveal', `${project.dir}/${file.path}`)}>
                  Show
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-icon"
                  aria-label={`Open ${file.name} on gigacad.site`}
                  title="Open on gigacad.site"
                  onClick={() => void act('openExternal', `${projectUrl(state, project)}/entries/${file.entryId}`)}
                >
                  <ExternalIcon className="icon" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// --- New branch --------------------------------------------------------------------------

/** A small sheet over the project: a name, checked as you type, and where to start from. */
function NewBranchSheet({ project, onClose, onCreated }: { project: ProjectState; onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState('latest');
  const [touched, setTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const problem = branchNameProblem(name.trim()) ?? (project.branches.some((branch) => branch.name.toLowerCase() === name.trim().toLowerCase()) ? 'A branch with this name already exists.' : null);

  const create = async () => {
    setCreating(true);
    const done = await act('createBranch', project.id, name.trim(), from === 'latest' ? null : Number(from));
    setCreating(false);
    if (done) {
      toast(`Created ${name.trim()}`);
      onClose();
      onCreated(name.trim());
    }
  };

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-branch-title"
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!problem) void create();
        }}
      >
        <h2 id="new-branch-title">New branch</h2>
        <label className="field">
          Name
          <input
            ref={input}
            value={name}
            placeholder="gripper-v2"
            aria-invalid={touched && problem !== null}
            aria-describedby="new-branch-problem"
            onChange={(event) => {
              setName(event.target.value);
              setTouched(true);
            }}
          />
          <span id="new-branch-problem" className={`field-note${touched && problem ? ' is-error' : ''}`}>
            {touched && problem ? problem : 'Letters, digits, dots, dashes, or underscores.'}
          </span>
        </label>
        <label className="field">
          Start from
          <select value={from} onChange={(event) => setFrom(event.target.value)}>
            <option value="latest">The latest release</option>
            {project.releases.map((release) => (
              <option key={release.number} value={String(release.number)}>
                v{release.number}
                {release.title ? ` · ${release.title}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="sheet-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={creating || (touched && problem !== null)}>
            {creating ? 'Creating…' : 'Create and download'}
          </button>
        </div>
      </form>
    </div>
  );
}
