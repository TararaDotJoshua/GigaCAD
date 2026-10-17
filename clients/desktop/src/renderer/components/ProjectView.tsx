import { useRef, useState, type RefObject } from 'react';
import type { AppState, ProjectState, ReleasesToKeep } from '../../shared/types.js';
import { platformWords } from '../../shared/platform.js';
import { act, ago, call, toast, useLoad } from '../api.js';
import { BranchIcon, DownloadIcon, ExternalIcon, FolderIcon, MergeIcon, PlusIcon, TagIcon } from '../icons.js';
import { approvableCandidate, candidateChangedSinceReview, shortCandidate } from '../review.js';
import { projectUrl, requestUrl } from '../urls.js';
import { ActionButton } from './ActionButton.js';
import { MoreMenu } from './Menu.js';
import { BranchNote } from './Sidebar.js';
import { Toolbar } from './Toolbar.js';

interface Props {
  readonly state: AppState;
  readonly project: ProjectState;
  readonly onOpenBranch: (name: string) => void;
}

export function ProjectView({ state, project, onOpenBranch }: Props) {
  const words = platformWords(state.app.platform);
  const [tab, setTab] = useState<'branches' | 'requests'>('branches');
  const newBranch = useRef<HTMLInputElement>(null);
  const url = projectUrl(state, project);
  return (
    <>
      <Toolbar state={state} crumbs={[{ label: project.owner }, { label: project.name }]} chip={project.role === 'viewer' ? <span className="chip">View only</span> : null}>
        {canEdit(project) ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setTab('branches');
              // The form is on the Branches tab; it becomes a sheet in phase 4 of the desktop UX plan.
              requestAnimationFrame(() => {
                newBranch.current?.scrollIntoView({ block: 'center' });
                newBranch.current?.focus();
              });
            }}
          >
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
        {tab === 'branches' ? (
          <Branches state={state} project={project} onOpenBranch={onOpenBranch} newBranch={newBranch} />
        ) : (
          <ReleaseRequests state={state} project={project} />
        )}
      </div>
    </>
  );
}

const canEdit = (project: ProjectState) => project.role !== null && project.role !== 'viewer';

function Branches({ state, project, onOpenBranch, newBranch }: Props & { newBranch: RefObject<HTMLInputElement | null> }) {
  const words = platformWords(state.app.platform);
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
                <BranchNote branch={branch} thisComputer={words.thisComputer} />
                {branch.downloaded ? (
                  branch.holder === 'me' ? null : (
                    <ActionButton
                      small
                      label="Remove download"
                      pending="Removing…"
                      done={`Removed the download of ${branch.name}`}
                      busy={branch.busy}
                      run={() => act('removeBranch', project.id, branch.name)}
                    />
                  )
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
              Keep on {words.thisComputer}
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
                  <ActionButton
                    small
                    label="Download"
                    pending="Downloading…"
                    done={`Downloaded v${release.number}`}
                    icon={<DownloadIcon className="icon" />}
                    run={() => act('downloadRelease', project.id, release.number)}
                  />
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
                <input ref={newBranch} value={name} placeholder="gripper-v2" onChange={(event) => setName(event.target.value)} />
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
  /** The candidate this list shows; approving names it, so a newer one isn't approved unseen. */
  readonly candidateManifestId?: string | null;
}

function ReleaseRequests({ state, project }: { state: AppState; project: ProjectState }) {
  const requests = useLoad(() => call('releaseRequests', project.id) as Promise<RequestSummary[]>, [project.id]);
  const openable = project.branches.filter((branch) => branch.status === 'open');
  const [branch, setBranch] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [opening, setOpening] = useState(false);
  // The candidate each request showed when Review opened it on the web; Approve names that one.
  const [reviewed, setReviewed] = useState<ReadonlyMap<number, string>>(new Map());
  const url = (number: number) => requestUrl(state, project, number);
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
                  {request.status === 'candidate' && request.candidateManifestId && (
                    <span className="faint mono" title={`Candidate ${request.candidateManifestId}`}>
                      {' '}
                      · candidate {shortCandidate(request.candidateManifestId)} · {ago(request.updatedAt)}
                    </span>
                  )}
                </span>
                <span className={`badge${request.status === 'candidate' ? ' badge-caution' : ''}`}>{request.status === 'candidate' ? 'awaiting approval' : request.status}</span>
                {canEdit(project) && candidateChangedSinceReview(request, reviewed) ? <span className="faint">Changed since you opened it. Review it again.</span> : null}
                {canEdit(project) && approvableCandidate(request, reviewed) ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => void act('approveReleaseRequest', project.id, request.number, approvableCandidate(request, reviewed)!).then((done) => done && requests.reload())}
                  >
                    Approve {shortCandidate(request.candidateManifestId!)}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    const candidate = request.candidateManifestId;
                    if (candidate) setReviewed((current) => new Map(current).set(request.number, candidate));
                    void act('openExternal', url(request.number));
                  }}
                >
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
