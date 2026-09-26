import { isReservedHandle } from '@gigacad/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActivityList } from '../../../components/product/ActivityList';
import { Avatar } from '../../../components/product/Avatar';
import { ContributionGraph } from '../../../components/product/ContributionGraph';
import { EmptyState } from '../../../components/product/EmptyState';
import { ProjectCards } from '../../../components/product/ProjectCards';
import { RelativeTime } from '../../../components/product/RelativeTime';
import { Shell } from '../../../components/product/Shell';
import { getUserPage, getUserStars, getViewer } from '../../../lib/product';

export async function generateMetadata({ params }: { params: Promise<{ owner: string }> }) {
  return { title: `@${(await params).owner}` };
}

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ owner }, query] = await Promise.all([params, searchParams]);
  if (isReservedHandle(owner)) notFound();
  const tab = query.tab === 'starred' ? 'starred' : 'projects';
  const [{ profile, projects, contributions = [], activity = [] }, viewer, starred] = await Promise.all([
    getUserPage(owner),
    getViewer(),
    tab === 'starred' ? getUserStars(owner) : Promise.resolve(null),
  ]);
  const self = viewer?.handle === profile.handle;
  const tabLink = (value: 'projects' | 'starred', label: string, count: number) => (
    <Link
      href={value === 'starred' ? `/${profile.handle}?tab=starred` : `/${profile.handle}`}
      className={`segment${tab === value ? ' is-selected' : ''}`}
      aria-current={tab === value ? 'page' : undefined}
    >
      {label} <small className="segment-count">{count}</small>
    </Link>
  );

  return (
    <Shell>
      <div className="page profile-layout">
        <aside className="profile-side">
          <Avatar handle={profile.handle} url={profile.avatarUrl} size="lg" />
          <div className="profile-names">
            <h1 className="app-title">{profile.displayName ?? `@${profile.handle}`}</h1>
            {profile.displayName && <p className="mono muted">@{profile.handle}</p>}
          </div>
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
          {self && (
            <Link href="/settings" className="btn btn-secondary profile-edit">
              Edit profile
            </Link>
          )}
          <ul className="profile-facts">
            {profile.location && <li>{profile.location}</li>}
            {profile.website && (
              <li>
                <a href={profile.website} rel="nofollow ugc noopener" target="_blank">
                  {profile.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              </li>
            )}
            <li className="muted">
              Joined <RelativeTime value={profile.createdAt} />
            </li>
          </ul>
        </aside>

        <div className="profile-main">
          <ContributionGraph days={contributions} />

          <nav className="segmented interval-toggle profile-tabs" aria-label="Projects">
            {tabLink('projects', 'Projects', projects.length)}
            {tabLink('starred', 'Starred', profile.starCount)}
          </nav>
          {tab === 'projects' ? (
            projects.length > 0 ? (
              <ProjectCards projects={projects} showOwner={false} />
            ) : (
              <EmptyState title={self ? 'You have no projects yet.' : `@${profile.handle} has no public projects yet.`} />
            )
          ) : starred && starred.length > 0 ? (
            <ProjectCards projects={starred} />
          ) : (
            <EmptyState title={self ? 'You haven’t starred any projects yet.' : `@${profile.handle} hasn’t starred any public projects yet.`} />
          )}

          <section className="section profile-activity">
            <h2>Recent activity</h2>
            {activity.length > 0 ? (
              <ActivityList activity={activity} />
            ) : (
              <EmptyState title={self ? 'Nothing yet this year.' : `No public activity from @${profile.handle} this year.`} />
            )}
          </section>
        </div>
      </div>
    </Shell>
  );
}
