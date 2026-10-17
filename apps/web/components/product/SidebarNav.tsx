'use client';

import { isPlaceholderHandle } from '@gigacad/core';
import Link, { useLinkStatus } from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { projectPath } from '../../lib/paths';
import { createClient } from '../../lib/supabase/client';
import { useDismiss } from '../../lib/use-dismiss';
import { BranchIcon, LockIcon, LogOutIcon, MenuIcon, SearchIcon, StarIcon } from '../icons';
import { Logo } from '../Logo';
import { Avatar } from './Avatar';
import { RelativeTime } from './RelativeTime';

export interface NavProject {
  readonly owner: string;
  readonly slug: string;
  readonly name: string;
  readonly canManage?: boolean;
  readonly activeRequests?: number;
  /** Open and frozen branches. `holder` is "you", someone's handle, or null when nobody has it checked out. */
  readonly branches?: readonly { readonly name: string; readonly holder: string | null; readonly since?: string | null }[];
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
  const sidebar = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  // The phone menu closes on Escape (back to its button) or a tap outside it.
  useDismiss(open, sidebar, (how) => {
    setOpen(false);
    if (how === 'escape') toggle.current?.focus();
  });
  const shown = projects.filter((p) => `${p.owner}/${p.slug} ${p.name}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const isCurrent = (p: NavProject) => current?.owner === p.owner && current.slug === p.slug;

  // The layout (and its pathname) outlives in-page navigation, so read the full address, query included, at click time.
  function withReturn(event: React.MouseEvent<HTMLAnchorElement>, page: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    router.push(`${page}?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }

  async function logOut() {
    await createClient().auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <aside ref={sidebar} className="shell-sidebar" data-open={open}>
      <div className="shell-sidebar-top">
        <Link href={home} className="shell-logo" aria-label="Your projects">
          <Logo />
        </Link>
        <button ref={toggle} type="button" className="shell-menu-toggle" aria-expanded={open} aria-controls="shell-nav" onClick={() => setOpen(!open)}>
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
          <Pending />
        </Link>

        <p className="app-sidebar-heading">{me || !current ? 'Projects' : 'This project'}</p>
        <ul className="app-nav">
          {shown.map((p) => (
            <li key={`${p.owner}/${p.slug}`} className={isCurrent(p) ? 'is-current' : undefined}>
              <Link href={projectPath(p.owner, p.slug)} title={`${p.owner}/${p.slug}`} onClick={() => setOpen(false)}>
                {/* Someone else's project shows whose it is, so a fork and its source never look the same. */}
                <span>
                  {p.owner !== me?.handle && <span className="app-nav-owner">{p.owner}/</span>}
                  {p.name}
                </span>
                <Pending />
              </Link>
              {isCurrent(p) && current && <ProjectSections project={current} pathname={pathname} onNavigate={() => setOpen(false)} />}
            </li>
          ))}
          {shown.length === 0 && <li className="app-nav-empty">{filter ? 'No matches' : me ? 'No projects yet' : 'Log in to see your projects'}</li>}
        </ul>

        {me ? (
          <div className="shell-account">
            {isPlaceholderHandle(me.handle) ? (
              // New accounts have a generated handle until they choose one; don't show it off.
              <Link href={home} onClick={() => setOpen(false)}>
                <Avatar handle="?" url={me.avatarUrl} />Choose a handle
              </Link>
            ) : (
              <Link href={`/${me.handle}`} className={pathname === `/${me.handle}` ? 'is-active' : undefined} onClick={() => setOpen(false)}>
                <Avatar handle={me.handle} url={me.avatarUrl} />@{me.handle}
              </Link>
            )}
            <button type="button" onClick={logOut} title="Log out">
              <LogOutIcon className="icon" />
              <span className="sr-only">Log out</span>
            </button>
          </div>
        ) : (
          <div className="shell-account shell-signed-out">
            <Link href={`/login?next=${encodeURIComponent(pathname)}`} onClick={(event) => withReturn(event, '/login')}>
              Log in
            </Link>
            <Link href={`/signup?next=${encodeURIComponent(pathname)}`} onClick={(event) => withReturn(event, '/signup')} className="btn btn-primary btn-small">
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
          <Pending />
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
              <Pending />
              {branch.holder === 'you' ? (
                <span className="dot dot-signal" title="Checked out by you" aria-label="checked out by you" />
              ) : branch.holder ? (
                <span className="app-nav-holder" title={`Checked out by @${branch.holder}`}>
                  <LockIcon className="icon" />@{branch.holder}
                  {branch.since && (
                    <span className="app-nav-age">
                      {' · '}
                      <RelativeTime value={branch.since} compact />
                    </span>
                  )}
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
      {section(`${base}/activity`, 'Activity', true)}
      {project.canManage && section(`${base}/settings`, 'Settings')}
    </ul>
  );
}

/**
 * A dot that pulses while its link's page loads, since most pages have no loading skeleton
 * and a click would otherwise look dead on a slow connection. The row highlights too (CSS).
 */
function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={pending ? 'nav-pending is-pending' : 'nav-pending'} />;
}
