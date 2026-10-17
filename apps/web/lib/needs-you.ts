import { approverIneligibility, type ProjectRole } from '@gigacad/core';
import type { Branch, Project, ReleaseRequestDetail } from './api';
import { getApprovalRules, getBranches, getReleaseRequest, getReleaseRequests } from './product';

/** A lock someone has held this long without saving gets a nudge, like the stale-checkout email. */
export const STALE_LOCK_DAYS = 7;
/** The dashboard reads each project separately, so it looks at this many at most. */
const MAX_PROJECTS = 30;

type Request = ReleaseRequestDetail['releaseRequest'];

export interface NeedsYou {
  /** Candidates waiting on your approval: you're eligible, haven't approved this candidate, and more are needed. */
  readonly approve: readonly { readonly project: Project; readonly request: Request }[];
  /** Your requests with enough approvals to release now. */
  readonly release: readonly { readonly project: Project; readonly request: Request }[];
  /** Branches you have checked out. */
  readonly locks: readonly { readonly project: Project; readonly branch: Branch }[];
  /** Other people's locks older than a week, in projects you manage, which you can force-release. */
  readonly stale: readonly { readonly project: Project; readonly branch: Branch }[];
}

const isActive = (status: string) => status === 'open' || status === 'candidate';
const manages = (role: ProjectRole | null) => role === 'owner' || role === 'maintainer';

/**
 * What's waiting on you across your projects, built from the reads the pages already use:
 * each project's branches and release requests, and the details of requests with a candidate.
 */
export async function getNeedsYou(me: { id: string }, projects: readonly Project[], now = new Date()): Promise<NeedsYou> {
  const member = projects.filter((project) => project.role !== null).slice(0, MAX_PROJECTS);
  const perProject = await Promise.all(
    member.map(async (project) => {
      const [branches, requests] = await Promise.all([getBranches(project.id).catch(() => []), getReleaseRequests(project.id).catch(() => [])]);
      const active = requests.filter((request) => isActive(request.status));
      const [details, rules] = await Promise.all([
        Promise.all(active.filter((request) => request.status === 'candidate').map((request) => getReleaseRequest(request.id).catch(() => null))),
        active.length ? getApprovalRules(project.id).catch(() => null) : null,
      ]);
      const approve: NeedsYou['approve'][number][] = [];
      const release: NeedsYou['release'][number][] = [];
      for (const detail of details) {
        if (!detail?.candidate?.upToDate || !detail.approvals.evaluation) continue;
        const request = detail.releaseRequest;
        const evaluation = detail.approvals.evaluation;
        if (request.requesterId === me.id) {
          if (evaluation.canRelease) release.push({ project, request });
          continue;
        }
        const needsMore = evaluation.blockers.some((blocker) => blocker.kind === 'needs_approvals');
        const eligible = rules && project.role && approverIneligibility(rules, me.id, project.role, request.requesterId ?? '') === undefined;
        if (needsMore && eligible && !evaluation.countedUserIds.includes(me.id)) approve.push({ project, request });
      }
      const open = branches.filter((branch) => branch.status === 'open' || branch.status === 'frozen');
      const locks = open.filter((branch) => branch.checkedOutBy === me.id).map((branch) => ({ project, branch }));
      const stale = manages(project.role)
        ? open
            .filter((branch) => branch.checkedOutBy && branch.checkedOutBy !== me.id && branch.checkedOutAt && now.getTime() - new Date(branch.checkedOutAt).getTime() > STALE_LOCK_DAYS * 86_400_000)
            .map((branch) => ({ project, branch }))
        : [];
      return { approve, release, locks, stale };
    }),
  );
  return {
    approve: perProject.flatMap((entry) => entry.approve),
    release: perProject.flatMap((entry) => entry.release),
    locks: perProject.flatMap((entry) => entry.locks),
    stale: perProject.flatMap((entry) => entry.stale),
  };
}
