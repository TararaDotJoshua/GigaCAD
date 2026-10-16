import type { ApprovalRules, ItemChange, PickRow, ProjectRole, ReleaseBlocker } from '@gigacad/core';
import type { Branch, Commit, Member, ProjectEvent, ReleaseRequestStatus } from './api';

/**
 * Every state has exactly one treatment (docs/design/README.md, "Color").
 * `signal` is for good or final states only; `caution` and `danger` for problems.
 */
export type Tone = 'signal' | 'open' | 'caution' | 'danger' | 'quiet';

export function branchTone(status: Branch['status']): Tone {
  return status === 'released' ? 'signal' : status === 'open' ? 'open' : status === 'frozen' ? 'caution' : 'quiet';
}

export const BRANCH_STATUS_LABEL: Record<Branch['status'], string> = {
  open: 'Open',
  frozen: 'Frozen for release',
  released: 'Released',
  archived: 'Archived',
};

export function requestTone(status: ReleaseRequestStatus): Tone {
  return status === 'released' ? 'signal' : status === 'closed' ? 'quiet' : 'open';
}

export const REQUEST_STATUS_LABEL: Record<ReleaseRequestStatus, string> = {
  open: 'Open',
  candidate: 'Candidate ready',
  released: 'Released',
  closed: 'Closed',
};

/** The note under a file in the pick table. */
export function rowNote(row: PickRow, latestReleaseNumber: number | null): { text: string; caution: boolean } {
  if (row.conflict) return { text: 'Changed on both sides', caution: true };
  if (row.branchChange) return { text: describeChange(row.branchChange, 'branch'), caution: false };
  if (row.mainChange) {
    const where = latestReleaseNumber ? `main in v${latestReleaseNumber}` : 'main';
    return { text: describeChange(row.mainChange, where), caution: false };
  }
  return { text: 'Unchanged', caution: false };
}

function describeChange(change: ItemChange, where: string): string {
  switch (change.kind) {
    case 'added':
      return `New on ${where}`;
    case 'deleted':
      return `Deleted on ${where}`;
    case 'modified':
      if (change.moved && change.contentChanged) return `Moved from ${change.before.path} and changed on ${where}`;
      if (change.moved) return `Moved from ${change.before.path} on ${where}`;
      return `Changed on ${where}`;
  }
}

/** A change between two snapshots, as a short verb for commit and history lists. */
export function changeVerb(change: ItemChange): string {
  if (change.kind === 'added') return 'Added';
  if (change.kind === 'deleted') return 'Deleted';
  if (change.moved && change.contentChanged) return `Moved from ${change.before.path} and edited`;
  return change.moved ? `Moved from ${change.before.path}` : 'Edited';
}

export function blockerText(blocker: ReleaseBlocker): string {
  switch (blocker.kind) {
    case 'needs_approvals':
      return `Needs ${blocker.need - blocker.have} more approval${blocker.need - blocker.have === 1 ? '' : 's'}`;
    case 'not_enough_eligible_approvers':
      return `Only ${blocker.eligible} of the ${blocker.need} required approvers are eligible. Change the approval rules in settings.`;
    case 'rebuild_missing':
      return 'Needs a clean rebuild of this candidate from the SolidWorks add-in';
    case 'rebuild_stale':
      return 'The rebuild report is for an older candidate';
    case 'rebuild_failed':
      return 'The rebuild failed. Fix the errors and rebuild again';
  }
}

/** Members who may approve under the project's rules, in member order. */
export function eligibleApprovers(members: readonly Member[], rules: ApprovalRules, requesterId: string | null): Member[] {
  return members.filter(
    (member) =>
      (rules.approverUserIds.includes(member.userId) || rules.approverRoles.includes(member.role as ProjectRole)) &&
      (rules.allowSelfApproval || member.userId !== requesterId),
  );
}

export type TimelineEntry =
  | { readonly kind: 'version'; readonly commit: Commit }
  | { readonly kind: 'autosaves'; readonly commits: readonly Commit[] };

/** Newest first. Consecutive autosaves become one group, the way the drive shows unsaved work. */
export function groupTimeline(commits: readonly Commit[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const commit of commits) {
    const last = entries.at(-1);
    if (commit.kind === 'autosave') {
      if (last?.kind === 'autosaves') entries[entries.length - 1] = { kind: 'autosaves', commits: [...last.commits, commit] };
      else entries.push({ kind: 'autosaves', commits: [commit] });
    } else {
      entries.push({ kind: 'version', commit });
    }
  }
  return entries;
}

/** Part of an activity line: plain text, or text that links to what it names. */
export type Segment = string | { readonly text: string; readonly href: string; readonly mono?: boolean };
export type Line = readonly Segment[];

/** An activity line as plain text, for titles and tests. */
export const lineText = (line: Line | undefined): string | undefined => line?.map((part) => (typeof part === 'string' ? part : part.text)).join('');

/** How the activity names people and things. Everything but `handle` and `branch` is optional. */
export interface EventNames {
  /** "@alex" for a user id. `known` is the handle the event carries, for people who have since left. */
  handle: (userId: string | null, known?: string | null) => string;
  branch: (branchId: string | null) => string | undefined;
  request?: (requestId: string | null) => { readonly number: number; readonly title: string } | undefined;
  /** A release's title, by number. */
  release?: (number: number) => string | null | undefined;
  tag?: (tagId: string) => string | undefined;
  href?: {
    readonly branch: (name: string) => string;
    readonly request: (number: number) => string;
    readonly release: (number: number) => string;
    readonly commit: (id: string) => string;
  };
}

const PROJECT_FIELDS: Readonly<Record<string, string>> = { name: 'name', description: 'description', visibility: 'visibility', license: 'license' };

/** "renamed the project to Rover", "made the project public", "changed the description". */
function projectChanges(payload: Record<string, unknown>): string {
  const parts = Object.entries(payload).flatMap(([field, value]) => {
    // Older events recorded the fields sent, not { from, to }.
    const change = value && typeof value === 'object' && 'to' in value ? (value as { from: unknown; to: unknown }) : { from: undefined, to: value };
    if (field === 'visibility') return [`made the project ${String(change.to)}`];
    if (field === 'name') return [change.from === undefined ? 'saved the project name' : `renamed the project from ${String(change.from)} to ${String(change.to)}`];
    if (field === 'license') return [change.to ? `set the license to ${String(change.to)}` : 'removed the license'];
    if (PROJECT_FIELDS[field]) return [`changed the ${PROJECT_FIELDS[field]}`];
    return [];
  });
  if (parts.length === 0) return 'changed the project settings';
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** "1 approval from a maintainer or owner, requester can approve". */
function rulesSummary(payload: Record<string, unknown>): string {
  const count = Number(payload.requiredCount ?? 0);
  if (count === 0) return 'no approvals needed';
  const roles = Array.isArray(payload.approverRoles) ? (payload.approverRoles as string[]) : [];
  const people = Array.isArray(payload.approverUserIds) ? payload.approverUserIds.length : 0;
  const from = [...(roles.length ? [`${roles.join(' or ')}s`] : []), ...(people ? [`${people} named ${people === 1 ? 'person' : 'people'}`] : [])];
  const extras = [...(payload.allowSelfApproval ? ['requester can approve'] : []), ...(payload.requireCleanRebuild ? ['clean rebuild required'] : [])];
  return [`${count} approval${count === 1 ? '' : 's'}${from.length ? ` from ${from.join(' or ')}` : ''}`, ...extras].join(', ');
}

const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** One sentence per project event, with links to what it names. Unknown kinds and autosaves are skipped. */
export function describeEvent(event: ProjectEvent, names: EventNames): Line | undefined {
  const who = names.handle(event.actorId, event.actorHandle);
  const payload = event.payload ?? {};
  const branchName = names.branch(event.subjectId);
  const branch = (name: string | undefined): Segment => (name ? (names.href ? { text: name, href: names.href.branch(name), mono: true } : name) : 'a branch');
  const request = (): Segment => {
    const found = names.request?.(event.subjectId);
    const number = found?.number ?? (typeof payload.number === 'number' ? payload.number : undefined);
    if (number === undefined) return 'a release request';
    const text = `#${number}${found?.title ? ` ${found.title}` : ''}`;
    return names.href ? { text, href: names.href.request(number) } : text;
  };
  switch (event.kind) {
    case 'project_created':
      return [`${who} created the project`];
    case 'project_updated':
      return [`${who} ${projectChanges(payload)}`];
    case 'project_deleted':
      return [`${who} deleted the project`];
    case 'project_restored':
      return [`${who} restored the project`];
    case 'branch_created':
      return [`${who} created branch `, branch(String(payload.name))];
    case 'branch_checked_out':
      return [`${who} checked out `, branch(branchName)];
    case 'branch_checked_in':
      return [`${who} checked in `, branch(branchName)];
    case 'branch_lock_force_released': {
      const holder = typeof payload.previousHolder === 'string' ? names.handle(payload.previousHolder, typeof payload.previousHolderHandle === 'string' ? payload.previousHolderHandle : null) : null;
      return [`${who} force-released ${holder ? `${holder}’s lock` : 'the lock'} on `, branch(branchName)];
    }
    case 'branch_archived':
      return [`${who} archived `, branch(branchName)];
    case 'commit_created': {
      if (payload.kind !== 'version') return undefined;
      const label = payload.versionLabel ? `version ${String(payload.versionLabel)}` : 'a version';
      const version: Segment = names.href && typeof payload.commitId === 'string' ? { text: label, href: names.href.commit(payload.commitId) } : label;
      return [`${who} committed `, version, ' on ', branch(branchName)];
    }
    case 'release_request_opened':
      return [`${who} opened release request `, request()];
    case 'release_request_picks_changed':
      return [`${who} changed the picks on `, request()];
    case 'release_request_candidate_generated':
      return [`${who} built a candidate for `, request()];
    case 'release_request_candidate_updated':
      return [`${who} replaced ${Number(payload.changedFiles ?? 0) === 1 ? '1 file' : `${Number(payload.changedFiles ?? 0)} files`} in the candidate for `, request()];
    case 'release_request_rebuild_reported':
      return [`${who} reported a ${String(payload.status).replace(/_/g, ' ')} rebuild of `, request()];
    case 'release_request_approved':
      return [`${who} approved `, request()];
    case 'release_request_approval_withdrawn':
      return [`${who} withdrew their approval of `, request()];
    case 'release_request_closed':
      return [`${who} closed `, request()];
    case 'release_created': {
      const number = Number(payload.number);
      const text = releaseName({ number, title: names.release?.(number) });
      return [`${who} released `, names.href ? { text, href: names.href.release(number) } : text];
    }
    case 'member_changed':
      return [payload.role ? `${who} made @${String(payload.handle)} a ${String(payload.role)}` : `${who} removed @${String(payload.handle)}`];
    case 'approval_rules_changed':
      return [`${who} changed the approval rules to ${rulesSummary(payload)}`];
    case 'directory_entry_created':
      return [`${who} added ${payload.kind === 'folder' ? 'folder ' : ''}${String(payload.path)}`];
    case 'root_file_replaced':
      return [`${who} saved revision ${String(payload.revision)} of ${String(payload.path)}`];
    case 'directory_entry_moved': {
      const from = String(payload.from);
      const to = String(payload.to);
      return [`${who} ${dirname(from) === dirname(to) ? 'renamed' : 'moved'} ${from} to ${to}`];
    }
    case 'directory_entry_deleted':
      return [`${who} deleted ${String(payload.path)}`];
    case 'tag_created':
      return [`${who} added the tag ${String(payload.name)}`];
    case 'tag_renamed':
      return [`${who} renamed the tag ${String(payload.from)} to ${String(payload.to)}`];
    case 'tag_deleted':
      return [`${who} deleted the tag ${String(payload.name)}`];
    case 'file_tags_changed': {
      const tags = (Array.isArray(payload.tagIds) ? (payload.tagIds as string[]) : []).map((id) => names.tag?.(id)).filter(Boolean);
      return [tags.length ? `${who} tagged a file ${tags.join(', ')}` : `${who} changed a file’s tags`];
    }
    default:
      return undefined;
  }
}

const BRANCH_WORK = new Set(['branch_checked_out', 'branch_checked_in', 'commit_created']);
/** Saying these twice in a row adds nothing; older feeds have repeats from before the API skipped them. */
const REPEATS = new Set(['release_request_approved', 'release_request_picks_changed', 'release_request_candidate_generated', 'file_tags_changed', 'project_restored']);

/**
 * Folds the feed so a day of work reads in a few lines. Entries are newest first, as the feed
 * shows them, and each run keeps its newest time:
 * - one person's checkouts, check-ins and commits on one branch: "committed 2 versions on longer-arms";
 * - one person's uploads into one folder: "added 30 files to Docs";
 * - the same thing done again right after: shown once.
 */
export function collapseActivity<T extends { event: ProjectEvent; line: Line }>(entries: readonly T[], names: EventNames): T[] {
  const out: T[] = [];
  let run: T[] = [];
  let kind: 'work' | 'upload' | null = null;
  const flush = () => {
    const first = run[0];
    if (!first) return;
    if (run.length === 1) out.push(first);
    else if (kind === 'upload') {
      const folder = dirname(String(first.event.payload?.path ?? ''));
      out.push({ ...first, line: [`${names.handle(first.event.actorId, first.event.actorHandle)} added ${run.length} files to ${folder || 'the project root'}`] });
    } else {
      const who = names.handle(first.event.actorId, first.event.actorHandle);
      const versions = run.filter((entry) => entry.event.kind === 'commit_created' && entry.event.payload?.kind === 'version');
      const branchName = names.branch(first.event.subjectId);
      const branch: Segment = branchName ? (names.href ? { text: branchName, href: names.href.branch(branchName) } : branchName) : 'a branch';
      // A single version keeps its own line, label and link included.
      if (versions.length === 1) out.push({ ...first, line: describeEvent(versions[0]!.event, names) ?? first.line });
      else out.push({ ...first, line: versions.length ? [`${who} committed ${versions.length} versions on `, branch] : [`${who} worked on `, branch] });
    }
    run = [];
    kind = null;
  };
  const isUpload = (event: ProjectEvent) => event.kind === 'directory_entry_created' && event.payload?.kind === 'file';
  for (const entry of entries) {
    const head = run[0]?.event;
    const { event } = entry;
    const work = BRANCH_WORK.has(event.kind);
    const upload = isUpload(event);
    const joins =
      head &&
      event.actorId === head.actorId &&
      ((kind === 'work' && work && event.subjectId === head.subjectId) || (kind === 'upload' && upload && dirname(String(event.payload?.path)) === dirname(String(head.payload?.path))));
    if (!joins) flush();
    if (work || upload) {
      kind = work ? 'work' : 'upload';
      run.push(entry);
      continue;
    }
    const last = out.at(-1)?.event;
    if (last && REPEATS.has(event.kind) && last.kind === event.kind && last.actorId === event.actorId && last.subjectId === event.subjectId) continue;
    out.push(entry);
  }
  flush();
  return out;
}

/** A release's display name: its release request's title, or just its number. */
export function releaseName(release: { number: number; title?: string | null }): string {
  return release.title ? `v${release.number}: ${release.title}` : `v${release.number}`;
}

const ASSEMBLY = /\.(sldasm|asm|iam)$/i;

/** Top-level files before nested ones, assemblies before parts and drawings, then by path: the assembly is what people look for. */
export function releaseFileOrder(a: { path: string }, b: { path: string }): number {
  const depth = Number(a.path.includes('/')) - Number(b.path.includes('/'));
  const kind = Number(!ASSEMBLY.test(a.path)) - Number(!ASSEMBLY.test(b.path));
  return depth || kind || a.path.localeCompare(b.path);
}
