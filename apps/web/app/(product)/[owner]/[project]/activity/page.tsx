import { PageHead } from '../../../../../components/product/PageHead';
import { RelativeTime } from '../../../../../components/product/RelativeTime';
import { collapseActivity, describeEvent } from '../../../../../lib/describe';
import { projectPath } from '../../../../../lib/paths';
import { getBranches, getEvents, getMembers, getProject } from '../../../../../lib/product';
import type { ProjectParams } from '../layout';

export async function generateMetadata({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project } = await params;
  return { title: `Activity · ${owner}/${project}` };
}

/** Everything that happened in the project, newest first, with runs of branch work folded together. */
export default async function ActivityPage({ params }: { params: Promise<ProjectParams> }) {
  const { owner, project: slug } = await params;
  const project = await getProject(owner, slug);
  const [events, members, branches] = await Promise.all([getEvents(project.id, 300), getMembers(project.id), getBranches(project.id)]);
  const handles = new Map(members.map((member) => [member.userId, member.handle]));
  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
  const names = {
    handle: (id: string | null) => (id && handles.has(id) ? `@${handles.get(id)}` : 'Someone'),
    branch: (id: string | null) => (id ? branchNames.get(id) : undefined),
  };
  const activity = collapseActivity(
    events.map((event) => ({ event, text: describeEvent(event, names) ?? '' })).filter((entry) => entry.text),
    names,
  );
  return (
    <div className="page page-narrow">
      <PageHead crumbs={[{ label: owner, href: `/${owner}` }, { label: project.name, href: projectPath(owner, slug) }, { label: 'Activity' }]} title="Activity" />
      {activity.length === 0 ? (
        <p className="muted">Nothing has happened in this project yet.</p>
      ) : (
        <ul className="activity activity-page">
          {activity.map(({ event, text }) => (
            <li key={event.id}>
              <span>{text}</span>
              <RelativeTime value={event.createdAt} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
