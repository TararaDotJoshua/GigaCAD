import { platformWords } from '../../shared/platform.js';
import type { AppState, BranchState, ProjectState } from '../../shared/types.js';
import type { Selection } from '../App.js';
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
            className={`link${selection.kind === 'settings' ? ' is-active' : ''}`}
            aria-label="Settings"
            onClick={() => onSelect({ kind: 'settings' })}
          >
            <SettingsIcon className="icon" />
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
  const shown = project.branches.filter((branch) => branch.downloaded || branch.holder === 'me');
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
        {project.error ? <span className="dot dot-danger" title={project.error} /> : null}
      </button>
      {shown.length > 0 ? (
        <ul className="nav">
          {shown.map((branch) => (
            <li key={branch.id}>
              <button
                type="button"
                className={`nav-row is-branch${selected && selection.branch === branch.name ? ' is-active' : ''}`}
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
