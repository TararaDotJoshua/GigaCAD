import Link from 'next/link';
import { ActivityLine } from '../../../../../components/product/ActivityLine';
import { PageHead } from '../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../components/product/RelativeTime';
import { getActivity } from '../../../../../lib/activity';
import { projectPath } from '../../../../../lib/paths';
import { getProject } from '../../../../../lib/product';
import type { ProjectParams } from '../layout';

/** Events per page; "Older" pages back from the last one shown. */
const PAGE = 200;

export async function generateMetadata({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project } = await params;
  if (!(await getProject(owner, project).catch(() => null))) return { title: 'Not found' };
  return { title: `Activity · ${owner}/${project}` };
}

/** Everything that happened in the project, newest first, with runs of work folded together. */
export default async function ActivityPage({ params, searchParams }: { params: Promise<ProjectParams>; searchParams: Promise<{ before?: string }> }) {
  const [{ owner, project: slug }, { before }] = await Promise.all([params, searchParams]);
  const project = await getProject(owner, slug);
  const { entries, older } = await getActivity(project, PAGE, before);
  const base = projectPath(owner, slug, 'activity');
  return (
    <div className="page">
      <PageHead crumbs={[{ label: owner, href: `/${owner}` }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Activity' }]} title="Activity" />
      {entries.length === 0 ? (
        <p className="muted">{before ? 'Nothing older.' : 'Nothing has happened in this project yet.'}</p>
      ) : (
        <ul className="activity activity-page">
          {entries.map(({ event, line }) => (
            <li key={event.id}>
              <ActivityLine line={line} />
              <RelativeTime value={event.createdAt} />
            </li>
          ))}
        </ul>
      )}
      {(older || before) && (
        <nav className="activity-pager" aria-label="More activity">
          {before && <Link href={base}>Newest</Link>}
          {older && <Link href={`${base}?before=${older}`}>Older</Link>}
        </nav>
      )}
    </div>
  );
}
