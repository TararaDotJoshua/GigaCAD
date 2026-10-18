import { platformWords } from '../../shared/platform.js';
import type { AppState, BranchState, ProjectState } from '../../shared/types.js';
import type { Selection } from '../view.js';
import { act } from '../api.js';
import { BranchIcon, CubeIcon, LockIcon, Logo, SettingsIcon } from '../icons.js';
import { UpdateBanner } from './UpdateBanner.js';

interface Props {
  readonly state: AppState;
  readonly selection: Selection;
  readonly onSelect: (selection: Selection) => void;
}

/** Projects grouped by owner, each with its downloaded branches (and any branch you hold). */
export function Sidebar({ state, selection, onSelect }: Props) {
  const projects = state.projects.filter((project) => !project.hidden);
  const owners = [...new Set(projects.map((project) => project.owner))];
  const fallback = selection.kind === 'none' ? projects[0]?.id : undefined;
  const setupFailed = state.setup.some((step) => step.status === 'error');

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag">
        <Logo />
      </div>
      <nav className="sidebar-scroll" aria-label="Projects">
        {owners.map((owner) => (
          <section key={owner}>
            <h2 className="sidebar-heading">{owner}</h2>
            <ul className="nav">
              {projects
                .filter((project) => project.owner === owner)
                .map((project) => (
                  <ProjectRows key={project.id} project={project} selection={selection} fallback={fallback} onSelect={onSelect} thisComputer={platformWords(state.app.platform).thisComputer} />
                ))}
            </ul>
          </section>
        ))}
        {projects.length === 0 ? <p className="sidebar-heading">No projects yet</p> : null}
      </nav>
      <div className="sidebar-bottom">
        <UpdateBanner state={state} />
        <div className="account">
          <span className="name">@{state.user?.handle}</span>
          <button
            type="button"
            className={`link settings-button${selection.kind === 'settings' ? ' is-active' : ''}`}
            aria-label={setupFailed ? 'Settings: a setup step failed' : 'Settings'}
            title={setupFailed ? 'A setup step failed' : 'Settings'}
            onClick={() => onSelect({ kind: 'settings' })}
          >
            <SettingsIcon className="icon" />
            {setupFailed ? <span className="dot dot-danger" aria-hidden="true" /> : null}
          </button>
        </div>
      </div>
    </aside>
  );
}

function ProjectRows({
  project,
  selection,
  fallback,
  onSelect,
  thisComputer,
}: {
  project: ProjectState;
  selection: Selection;
  fallback: string | undefined;
  onSelect: Props['onSelect'];
  thisComputer: string;
}) {
  const selected = selection.kind === 'project' && selection.projectId === project.id;
  // Downloaded branches and yours, plus the one that's open (dimmed when it isn't downloaded).
  const shown = project.branches.filter((branch) => branch.downloaded || branch.holder === 'me' || (selected && selection.branch === branch.name));
  return (
    <li>
      <button
        type="button"
        className={`nav-row${(selected && !selection.branch) || fallback === project.id ? ' is-active' : ''}`}
        onClick={() => onSelect({ kind: 'project', projectId: project.id })}
        onDoubleClick={() => void act('reveal', project.dir)}
      >
        <CubeIcon className="icon" />
        <span className="name">{project.name}</span>
        {project.error ? <span className="dot dot-danger" title={project.error} /> : project.conflicts.length > 0 ? <span className="dot dot-caution" title="A root file changed here and on gigacad.site" /> : null}
      </button>
      {shown.length > 0 ? (
        <ul className="nav">
          {shown.map((branch) => (
            <li key={branch.id}>
              <button
                type="button"
                className={`nav-row is-branch${selected && selection.branch === branch.name ? ' is-active' : ''}${branch.downloaded ? '' : ' is-cloud'}`}
                title={branch.downloaded ? undefined : `${branch.name} isn’t downloaded`}
                onClick={() => onSelect({ kind: 'project', projectId: project.id, branch: branch.name })}
              >
                <BranchIcon className="icon" />
                <span className="name">{branch.name}</span>
                <BranchNote branch={branch} thisComputer={thisComputer} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Signal green marks your checkout; someone else's shows their lock. */
export function BranchNote({ branch, thisComputer = 'this computer' }: { branch: BranchState; thisComputer?: string }) {
  if (branch.holder === 'me') return <span className="dot dot-signal" title={`Checked out on ${thisComputer}`} />;
  if (branch.holder === 'other') {
    return (
      <span className="nav-note" title={`Checked out by @${branch.holderHandle} on ${branch.holderMachine}`}>
        <LockIcon className="icon" />@{branch.holderHandle}
      </span>
    );
  }
  return null;
}
