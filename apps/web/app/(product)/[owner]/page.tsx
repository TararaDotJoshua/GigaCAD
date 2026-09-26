import { isReservedHandle } from '@gigacad/core';
import { notFound } from 'next/navigation';
import { EmptyState } from '../../../components/product/EmptyState';
import { PageHead } from '../../../components/product/PageHead';
import { ProjectCards } from '../../../components/product/ProjectCards';
import { RelativeTime } from '../../../components/product/RelativeTime';
import { Shell } from '../../../components/product/Shell';
import { getUserPage, getViewer } from '../../../lib/product';

export async function generateMetadata({ params }: { params: Promise<{ owner: string }> }) {
  return { title: `@${(await params).owner}` };
}

export default async function UserPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner } = await params;
  if (isReservedHandle(owner)) notFound();
  const [{ profile, projects }, viewer] = await Promise.all([getUserPage(owner), getViewer()]);
  const self = viewer?.handle === profile.handle;
  return (
    <Shell>
      <div className="page">
        <PageHead
          crumbs={[{ label: 'GigaCAD' }, { label: `@${profile.handle}` }]}
          title={profile.displayName ?? `@${profile.handle}`}
          meta={
            <>
              {profile.displayName && <span className="mono">@{profile.handle}</span>}
              <span>
                Joined <RelativeTime value={profile.createdAt} />
              </span>
            </>
          }
        />
        {projects.length > 0 ? (
          <ProjectCards projects={projects} showOwner={false} />
        ) : (
          <EmptyState title={self ? 'You have no projects yet.' : `@${profile.handle} has no public projects yet.`} />
        )}
      </div>
    </Shell>
  );
}
