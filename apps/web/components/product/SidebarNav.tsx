'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { projectPath } from '../../lib/paths';
import { createClient } from '../../lib/supabase/client';
import { BranchIcon, LockIcon, LogOutIcon, MenuIcon, SearchIcon, SettingsIcon, StarIcon } from '../icons';
import { Logo } from '../Logo';
import { Avatar } from './Avatar';

export interface NavProject {
  readonly owner: string;
  readonly slug: string;
  readonly name: string;
  readonly canManage?: boolean;
  readonly activeRequests?: number;
  /** Open and frozen branches. `holder` is "you", someone's handle, or null when nobody has it checked out. */
  readonly branches?: readonly { readonly name: string; readonly holder: string | null }[];
}

export function SidebarNav({
  me,
  home,
  projects,
  current,
}: {
  /** Null for a signed-out visitor to a public page. */
  me: { handle: string; avatarUrl: string | null } | null;
  /** The dashboard's path: `/` on the app host, `/app` in local development. */
  home: string;
  projects: readonly NavProject[];
  current?: NavProject;
}) {
  const pathname = decodeURIComponent(usePathname());
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const shown = projects.filter((p) => `${p.owner}/${p.slug} ${p.name}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const isCurrent = (p: NavProject) => current?.owner === p.owner && current.slug === p.slug;

  async function logOut() {
    await createClient().auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="shell-sidebar" data-open={open}>
      <div className="shell-sidebar-top">
        <Link href={home} className="shell-logo" aria-label="Your projects">
          <Logo />
        </Link>
        <button type="button" className="shell-menu-toggle" aria-expanded={open} aria-controls="shell-nav" onClick={() => setOpen(!open)}>
          <MenuIcon className="icon" />
          <span className="sr-only">Menu</span>
        </button>
      </div>

      <div id="shell-nav" className="shell-nav">
        <label className="app-search shell-search">
          <SearchIcon className="icon" />
          <span className="sr-only">Jump to a project</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Jump to a project" />
        </label>

        <Link href="/explore" className={`shell-explore${pathname === '/explore' ? ' is-active' : ''}`} onClick={() => setOpen(false)}>
          <StarIcon className="icon" />
          Explore public projects
        </Link>

        <p className="app-sidebar-heading">{me ? 'Projects' : 'This project'}</p>
        <ul className="app-nav">
          {shown.map((p) => (
            <li key={`${p.owner}/${p.slug}`} className={isCurrent(p) ? 'is-current' : undefined}>
              <Link href={projectPath(p.owner, p.slug)} onClick={() => setOpen(false)}>
                {p.name}
              </Link>
              {isCurrent(p) && current && <ProjectSections project={current} pathname={pathname} onNavigate={() => setOpen(false)} />}
            </li>
          ))}
          {shown.length === 0 && <li className="app-nav-empty">{filter ? 'No matches' : me ? 'No projects yet' : 'Log in to see your projects'}</li>}
        </ul>

        {me ? (
          <div className="shell-account">
            <Link href={`/${me.handle}`} className={pathname === `/${me.handle}` ? 'is-active' : undefined} onClick={() => setOpen(false)}>
              <Avatar handle={me.handle} url={me.avatarUrl} />@{me.handle}
            </Link>
            <div className="shell-account-actions">
              <Link
                href="/settings"
                className={`shell-account-icon${pathname === '/settings' || pathname.startsWith('/settings/') ? ' is-active' : ''}`}
                title="Account settings"
                onClick={() => setOpen(false)}
              >
                <SettingsIcon className="icon" />
                <span className="sr-only">Account settings</span>
              </Link>
              <button type="button" onClick={logOut} title="Log out">
                <LogOutIcon className="icon" />
                <span className="sr-only">Log out</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="shell-account shell-signed-out">
            <Link href={`/login?next=${encodeURIComponent(pathname)}`}>Log in</Link>
            <Link href="/signup" className="btn btn-primary btn-small">
              Sign up
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}

function ProjectSections({ project, pathname, onNavigate }: { project: NavProject; pathname: string; onNavigate: () => void }) {
  const base = projectPath(project.owner, project.slug);
  const section = (href: string, label: React.ReactNode, exact = false) => {
    const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    return (
      <li className={active ? 'is-active' : undefined}>
        <Link href={href} onClick={onNavigate} aria-current={active ? 'page' : undefined}>
          {label}
        </Link>
      </li>
    );
  };
  return (
    <ul className="app-nav app-nav-sections">
      {section(base, 'Files', true)}
      {section(`${base}/branches`, 'Branches', true)}
      {project.branches?.map((branch) => {
        const href = `${base}/branches/${encodeURIComponent(branch.name)}`;
        const active = pathname === `${base}/branches/${branch.name}`;
        return (
          <li key={branch.name} className={`app-nav-branch${active ? ' is-active' : ''}`}>
            <Link href={href} onClick={onNavigate}>
              <BranchIcon className="icon" />
              <span className="mono app-nav-branch-name">{branch.name}</span>
              {branch.holder === 'you' ? (
                <span className="dot dot-signal" title="Checked out by you" aria-label="checked out by you" />
              ) : branch.holder ? (
                <span className="app-nav-holder" title={`Checked out by @${branch.holder}`}>
                  <LockIcon className="icon" />@{branch.holder}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
      {section(
        `${base}/release-requests`,
        <>
          Release requests
          {project.activeRequests ? <span className="app-nav-count">{project.activeRequests}</span> : null}
        </>,
      )}
      {section(`${base}/releases`, 'Releases')}
      {project.canManage && section(`${base}/settings`, 'Settings')}
    </ul>
  );
}
