'use client';

import { isPlaceholderHandle } from '@gigacad/core';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { projectPath } from '../../lib/paths';
import { rememberSignedIn } from '../../lib/signed-in';
import { createClient } from '../../lib/supabase/client';
import { BranchIcon, CloseIcon, LockIcon, LogOutIcon, MenuIcon, SearchIcon, StarIcon } from '../icons';
import { Logo } from '../Logo';
import { Avatar } from './Avatar';

export interface NavProject {
  readonly owner: string;
  readonly slug: string;
  readonly name: string;
  readonly canManage?: boolean;
  readonly activeRequests?: number;
  /** Open and frozen branches. `holder` is "you", someone's handle, or null when nobody has it checked out. */
  readonly branches?: readonly { readonly name: string; readonly holder: string | null; readonly since?: string | null; readonly age?: string | null }[];
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
  const toggle = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const isCurrent = (p: NavProject) => current?.owner === p.owner && current.slug === p.slug;
  // The current project leads the list, so its sections are never below the fold.
  const shown = projects
    .filter((p) => `${p.owner}/${p.slug} ${p.name}`.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => Number(isCurrent(b)) - Number(isCurrent(a)));

  // Lets gigacad.site offer "Your projects" instead of "Log in".
  const signedIn = Boolean(me);
  useEffect(() => rememberSignedIn(signedIn), [signedIn]);

  // Keep the current page's row in view inside the scrolling list.
  useEffect(() => {
    const scroller = list.current;
    const row = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !row || scroller.clientHeight === 0) return;
    const top = row.offsetTop - scroller.offsetTop;
    if (top < scroller.scrollTop || top + row.offsetHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top - scroller.clientHeight / 3;
  }, [pathname]);

  // Escape closes the phone menu and returns focus to its button.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  /** Enter in the jump box opens the first match. */
  function jump(event: React.KeyboardEvent<HTMLInputElement>) {
    const first = shown[0];
    if (event.key !== 'Enter' || !filter.trim() || !first) return;
    event.preventDefault();
    setFilter('');
    setOpen(false);
    router.push(projectPath(first.owner, first.slug));
  }

  // The layout (and its pathname) outlives in-page navigation, so read the full address, query included, at click time.
  function withReturn(event: React.MouseEvent<HTMLAnchorElement>, page: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    router.push(`${page}?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }

  async function logOut() {
    await createClient().auth.signOut();
    rememberSignedIn(false);
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="shell-sidebar" data-open={open}>
      <div className="shell-sidebar-top">
        <Link href={home} className="shell-logo" aria-label="Your projects">
          <Logo />
        </Link>
        <button ref={toggle} type="button" className="shell-menu-toggle" aria-expanded={open} aria-controls="shell-nav" onClick={() => setOpen(!open)}>
          {open ? <CloseIcon className="icon" /> : <MenuIcon className="icon" />}
          <span className="sr-only">Menu</span>
        </button>
      </div>

      <nav id="shell-nav" className="shell-nav" aria-label="Projects">
        <label className="app-search shell-search">
          <SearchIcon className="icon" />
          <span className="sr-only">Jump to a project</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} onKeyDown={jump} placeholder="Jump to a project" />
        </label>

        <Link href="/explore" className={`shell-explore${pathname === '/explore' ? ' is-active' : ''}`} onClick={() => setOpen(false)}>
          <StarIcon className="icon" />
          Explore public projects
        </Link>

        <p className="app-sidebar-heading">{me || !current ? 'Projects' : 'This project'}</p>
        <ul className="app-nav" ref={list}>
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
              Create account
            </Link>
          </div>
        )}
      </nav>
    </div>
  );
}

/** Branches listed under a project before the rest fold into "All N branches". The active one always shows. */
const BRANCHES_SHOWN = 5;

function ProjectSections({ project, pathname, onNavigate }: { project: NavProject; pathname: string; onNavigate: () => void }) {
  const base = projectPath(project.owner, project.slug);
  const branchActive = (name: string) => pathname === `${base}/branches/${name}`;
  const branches = project.branches ?? [];
  const shownBranches = branches.filter((branch, index) => index < BRANCHES_SHOWN || branchActive(branch.name));
  const section = (href: string, label: React.ReactNode, exact = false, also: readonly string[] = []) => {
    const active = (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)) || also.some((prefix) => pathname.startsWith(prefix));
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
      {section(base, 'Files', true, [`${base}/tree/`, `${base}/entries/`])}
      {section(`${base}/branches`, 'Branches', true)}
      {shownBranches.map((branch) => {
        const href = `${base}/branches/${encodeURIComponent(branch.name)}`;
        const active = branchActive(branch.name);
        return (
          <li key={branch.name} className={`app-nav-branch${active ? ' is-active' : ''}`}>
            <Link href={href} onClick={onNavigate} aria-current={active ? 'page' : undefined} title={branch.name}>
              <BranchIcon className="icon" />
              <span className="mono app-nav-branch-name">{branch.name}</span>
              {branch.holder === 'you' ? (
                <>
                  <span className="dot dot-signal" title="Checked out by you" aria-hidden="true" />
                  <span className="sr-only">, checked out by you</span>
                </>
              ) : branch.holder ? (
                <span className="app-nav-holder" title={`Checked out by @${branch.holder}${branch.since ? ` since ${branch.since.slice(0, 16).replace('T', ' ')} UTC` : ''}`}>
                  <LockIcon className="icon" />@{branch.holder}
                  {branch.age && <span className="app-nav-age"> · {branch.age}</span>}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
      {branches.length > shownBranches.length && (
        <li className="app-nav-branch app-nav-more">
          <Link href={`${base}/branches`} onClick={onNavigate}>
            All {branches.length} branches
          </Link>
        </li>
      )}
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
