import { useState } from 'react';
import type { AppState, ProjectState, ReleasesToKeep } from '../../shared/types.js';
import { act, ago, call, useLoad } from '../api.js';
import { BranchIcon, DownloadIcon, FolderIcon, MergeIcon, PlusIcon, TagIcon } from '../icons.js';
import { BranchNote } from './Sidebar.js';
import { Toolbar } from './Toolbar.js';

interface Props {
  readonly state: AppState;
  readonly project: ProjectState;
  readonly onOpenBranch: (name: string) => void;
}

export function ProjectView({ state, project, onOpenBranch }: Props) {
  const [tab, setTab] = useState<'branches' | 'requests'>('branches');
  return (
    <>
      <Toolbar state={state} eyebrow={project.owner} title={project.name}>
        <button type="button" className="btn btn-secondary" onClick={() => void act('reveal', project.dir)}>
          <FolderIcon className="icon" />
          Show in Finder
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void act('openExternal', `${state.settings.appUrl}/${project.owner}/${project.slug}`)}>
          Open on gigacad.site
        </button>
      </Toolbar>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'branches'} className={`tab${tab === 'branches' ? ' is-active' : ''}`} onClick={() => setTab('branches')}>
          Branches &amp; releases
        </button>
        <button type="button" role="tab" aria-selected={tab === 'requests'} className={`tab${tab === 'requests' ? ' is-active' : ''}`} onClick={() => setTab('requests')}>
          Release requests
        </button>
      </div>
      <div className="content">
        {project.error ? <div className="notice is-error">{project.error}</div> : null}
        {tab === 'branches' ? <Branches state={state} project={project} onOpenBranch={onOpenBranch} /> : <ReleaseRequests state={state} project={project} />}
      </div>
    </>
  );
}

const canEdit = (project: ProjectState) => project.role !== null && project.role !== 'viewer';

function Branches({ state, project, onOpenBranch }: Props) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState('latest');
  const [creating, setCreating] = useState(false);
  const keep: ReleasesToKeep = state.settings.releases[project.id] ?? 'latest';

  const create = async () => {
    setCreating(true);
    const done = await act('createBranch', project.id, name.trim(), from === 'latest' ? null : Number(from));
    setCreating(false);
    if (done) {
      onOpenBranch(name.trim());
      setName('');
    }
  };

  return (
    <div className="split">
      <div>
        <section className="panel">
          <div className="panel-head">
            <BranchIcon className="icon" />
            Branches
          </div>
          <ul className="rows">
            {project.branches.map((branch) => (
              <li key={branch.id}>
                <button type="button" className="link grow strong" onClick={() => onOpenBranch(branch.name)}>
                  {branch.name}
                </button>
                {branch.status !== 'open' ? <span className="badge">{branch.status}</span> : null}
                <BranchNote branch={branch} />
                {branch.downloaded ? (
                  branch.holder === 'me' ? null : (
                    <button type="button" className="btn btn-secondary btn-small" disabled={branch.busy} onClick={() => void act('removeBranch', project.id, branch.name)}>
                      Remove download
                    </button>
                  )
                ) : (
                  <button type="button" className="btn btn-secondary btn-small" disabled={branch.busy} onClick={() => void act('downloadBranch', project.id, branch.name)}>
                    <DownloadIcon className="icon" />
                    Download
                  </button>
                )}
              </li>
            ))}
            {project.branches.length === 0 ? <li className="faint">No branches yet.</li> : null}
          </ul>
        </section>

        <section className="panel gap">
          <div className="panel-head">
            <TagIcon className="icon" />
            Releases
            <label className="push inline faint">
              Keep on this Mac
              <select className="select" value={keep} onChange={(event) => void act('setReleasesToKeep', project.id, event.target.value as ReleasesToKeep)}>
                <option value="latest">Latest</option>
                <option value="all">All</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>
          <ul className="rows">
            {project.releases.map((release) => (
              <li key={release.number}>
                <span className="strong">v{release.number}</span>
                <span className="grow faint" title={release.notes}>
                  {release.notes || 'No notes'}
                </span>
                <span className="faint">{ago(release.createdAt)}</span>
                {release.downloaded ? (
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('reveal', release.dir)}>
                    Show
                  </button>
                ) : (
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('downloadRelease', project.id, release.number)}>
                    <DownloadIcon className="icon" />
                    Download
                  </button>
                )}
              </li>
            ))}
            {project.releases.length === 0 ? <li className="faint">No releases yet.</li> : null}
          </ul>
        </section>
      </div>

      <div>
        {canEdit(project) ? (
          <section className="panel">
            <div className="panel-head">
              <PlusIcon className="icon" />
              New branch
            </div>
            <form
              className="panel-body"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim()) void create();
              }}
            >
              <label className="field">
                Name
                <input value={name} placeholder="gripper-v2" onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="field">
                Start from
                <select value={from} onChange={(event) => setFrom(event.target.value)}>
                  <option value="latest">The latest release</option>
                  {project.releases.map((release) => (
                    <option key={release.number} value={String(release.number)}>
                      v{release.number}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn btn-primary wide" disabled={creating || !name.trim()}>
                {creating ? 'Creating…' : 'Create and download'}
              </button>
            </form>
          </section>
        ) : null}
        <section className="panel gap">
          <div className="panel-head">On this Mac</div>
          <div className="panel-body">
            <p className="field-note">Hiding a project stops syncing it. Its folder stays where it is.</p>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void act('setProjectHidden', project.id, true)}>
              Stop syncing this project
            </button>
          </div>
        </section>
      </div>
    </div>
  );
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

function ReleaseRequests({ state, project }: { state: AppState; project: ProjectState }) {
  const requests = useLoad(() => call('releaseRequests', project.id) as Promise<RequestSummary[]>, [project.id]);
  const openable = project.branches.filter((branch) => branch.status === 'open');
  const [branch, setBranch] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [opening, setOpening] = useState(false);
  const url = (number: number) => `${state.settings.appUrl}/${project.owner}/${project.slug}/release-requests/${number}`;
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
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => void act('approveReleaseRequest', project.id, request.number).then((done) => done && requests.reload())}
                  >
                    Approve
                  </button>
                ) : null}
                <button type="button" className="link" onClick={() => void act('openExternal', url(request.number))}>
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
