import { useRef, useState } from 'react';
import { platformWords } from '../../shared/platform.js';
import type { AppState, BranchState, ProjectState } from '../../shared/types.js';
import { act } from '../api.js';
import { BranchIcon, CubeIcon, LockIcon, Logo, SearchIcon, SettingsIcon, SyncIcon } from '../icons.js';
import { branchItems, projectItems, showContextMenu } from '../menus.js';
import { useCollapsed, useRequest } from '../navigation.js';
import type { Selection } from '../view.js';
import { UpdateBanner } from './UpdateBanner.js';

interface Props {
  readonly state: AppState;
  readonly selection: Selection;
  readonly onSelect: (selection: Selection) => void;
}

/** Projects grouped by owner, each with its downloaded branches (and any branch you hold). */
export function Sidebar({ state, selection, onSelect }: Props) {
  const [filter, setFilter] = useState('');
  const [collapsed, toggle] = useCollapsed();
  const filterBox = useRef<HTMLInputElement>(null);
  useRequest('filter', () => {
    filterBox.current?.focus();
    filterBox.current?.select();
  });

  const query = filter.trim().toLowerCase();
  const matches = (project: ProjectState) =>
    !query ||
    [project.name, project.slug, project.owner].some((text) => text.toLowerCase().includes(query)) ||
    project.branches.some((branch) => branch.name.toLowerCase().includes(query));
  const all = state.projects.filter((project) => !project.hidden);
  const projects = all.filter(matches);
  const owners = [...new Set(projects.map((project) => project.owner))];
  const fallback = selection.kind === 'none' ? all[0]?.id : undefined;
  const setupFailed = state.setup.some((step) => step.status === 'error');

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag">
        <Logo />
      </div>
      {all.length > 0 ? (
        <div className="sidebar-filter">
          <SearchIcon className="icon" />
          <input
            ref={filterBox}
            type="search"
            value={filter}
            placeholder="Filter projects"
            aria-label="Filter projects"
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setFilter('');
                event.currentTarget.blur();
              }
            }}
          />
        </div>
      ) : null}
      <nav className="sidebar-scroll" aria-label="Projects">
        {owners.map((owner) => {
          // A filter shows every match, even in a collapsed group.
          const closed = collapsed.includes(owner) && !query;
          return (
            <section key={owner}>
              <h2 className="sidebar-heading">
                <button type="button" className="group-toggle" aria-expanded={!closed} onClick={() => toggle(owner)}>
                  <span className="caret" aria-hidden="true">
                    ▸
                  </span>
                  {owner}
                </button>
              </h2>
              {closed ? null : (
                <ul className="nav">
                  {projects
                    .filter((project) => project.owner === owner)
                    .map((project) => (
                      <ProjectRows key={project.id} state={state} project={project} selection={selection} fallback={fallback} onSelect={onSelect} />
                    ))}
                </ul>
              )}
            </section>
          );
        })}
        {all.length === 0 ? <p className="sidebar-heading">No projects yet</p> : projects.length === 0 ? <p className="sidebar-heading">No projects match “{filter}”</p> : null}
      </nav>
      <div className="sidebar-bottom">
        <UpdateBanner state={state} />
        <div className="account">
          <span className="name">@{state.user?.handle}</span>
          <button
            type="button"
            className={`link settings-button${selection.kind === 'settings' ? ' is-active' : ''}`}
            aria-label={setupFailed ? 'Settings: a setup step failed' : 'Settings'}
            aria-current={selection.kind === 'settings' ? 'page' : undefined}
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
  state,
  project,
  selection,
  fallback,
  onSelect,
}: {
  state: AppState;
  project: ProjectState;
  selection: Selection;
  fallback: string | undefined;
  onSelect: Props['onSelect'];
}) {
  const thisComputer = platformWords(state.app.platform).thisComputer;
  const selected = selection.kind === 'project' && selection.projectId === project.id;
  // Downloaded branches and yours, plus the one that's open (dimmed when it isn't downloaded).
  const shown = project.branches.filter((branch) => branch.downloaded || branch.holder === 'me' || (selected && selection.branch === branch.name));
  const active = (selected && !selection.branch) || fallback === project.id;
  return (
    <li>
      <button
        type="button"
        className={`nav-row${active ? ' is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelect({ kind: 'project', projectId: project.id })}
        onDoubleClick={() => void act('reveal', project.dir)}
        onContextMenu={(event) => showContextMenu(event, projectItems(state, project))}
      >
        <CubeIcon className="icon" />
        <span className="name">{project.name}</span>
        {project.error ? (
          <span className="dot dot-danger" role="img" aria-label={`Sync problem: ${project.error}`} title={project.error} />
        ) : project.conflicts.length > 0 ? (
          <span className="dot dot-caution" role="img" aria-label="A root file changed here and on gigacad.site" title="A root file changed here and on gigacad.site" />
        ) : null}
      </button>
      {shown.length > 0 ? (
        <ul className="nav">
          {shown.map((branch) => {
            const current = selected && selection.branch === branch.name;
            return (
              <li key={branch.id}>
                <button
                  type="button"
                  className={`nav-row is-branch${current ? ' is-active' : ''}${branch.downloaded ? '' : ' is-cloud'}`}
                  aria-current={current ? 'page' : undefined}
                  title={branch.downloaded ? undefined : `${branch.name} isn’t downloaded`}
                  onClick={() => onSelect({ kind: 'project', projectId: project.id, branch: branch.name })}
                  onContextMenu={(event) => showContextMenu(event, branchItems(state, project, branch))}
                >
                  <BranchIcon className="icon" />
                  <span className="name">{branch.name}</span>
                  {branch.busy ? (
                    <span className="nav-busy" role="img" aria-label="Working">
                      <SyncIcon className="icon spin" />
                    </span>
                  ) : <BranchNote branch={branch} thisComputer={thisComputer} />}
                </button>
              </li>
            );
          })}
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
