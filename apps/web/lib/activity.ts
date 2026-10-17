import type { Project, ProjectEvent } from './api';
import { collapseActivity, describeEvent, type EventNames, type Line } from './describe';
import { branchPath, commitPath, releasePath, releaseRequestPath } from './paths';
import { getBranches, getEvents, getReleaseRequests, getReleases, getTags, getVisibleMembers, isFullMember } from './product';

export interface ActivityEntry {
  readonly event: ProjectEvent;
  readonly line: Line;
}

/**
 * A page of the project's activity, newest first: each event as a sentence that links to what it
 * names, folded so runs of work read as one line. `older` is the cursor for the next page back.
 */
export async function getActivity(project: Project, limit: number, before?: string): Promise<{ entries: ActivityEntry[]; older: string | null }> {
  const [events, members, branches, requests, releases, tags] = await Promise.all([
    getEvents(project.id, limit, before),
    getVisibleMembers(project.id),
    getBranches(project.id),
    getReleaseRequests(project.id),
    getReleases(project.id),
    getTags(project.id),
  ]);
  // Outsiders get members' handles without ids; events carry their actor's handle for them.
  const handles = new Map(members.filter(isFullMember).map((member) => [member.userId, member.handle]));
  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  const releaseTitles = new Map(releases.map((release) => [release.number, release.title ?? null]));
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));
  const { ownerHandle: owner, slug } = project;
  const names: EventNames = {
    // People who have left are named by the handle the event carries.
    handle: (id, known) => (id && handles.has(id) ? `@${handles.get(id)}` : known ? `@${known}` : id ? 'A former member' : 'Someone'),
    branch: (id) => (id ? branchNames.get(id) : undefined),
    request: (id) => (id ? requestsById.get(id) : undefined),
    release: (number) => releaseTitles.get(number),
    tag: (id) => tagNames.get(id),
    href: {
      branch: (name) => branchPath(owner, slug, name),
      request: (number) => releaseRequestPath(owner, slug, number),
      release: (number) => releasePath(owner, slug, number),
      commit: (id) => commitPath(owner, slug, id),
    },
  };
  const described = events.flatMap((event) => {
    const line = describeEvent(event, names);
    return line ? [{ event, line }] : [];
  });
  return { entries: collapseActivity(described, names), older: events.length === limit ? events.at(-1)!.id : null };
}
