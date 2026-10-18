import type { ApprovalRules, CandidateError, CandidateWarning, ItemChange, PickRow, ProjectRole, ReleaseBlocker } from '@gigacad/core';
import type { Branch, Commit, Member, ProjectEvent, RebuildStatus, ReleaseRequestStatus } from './api';

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

/**
 * One badge for a request, the same in the list and on its page. A candidate is only
 * "ready" while it is built on the latest main and its rebuild (when required) passed.
 */
export function requestBadge(
  request: { status: ReleaseRequestStatus; upToDate: boolean; rebuildStatus: RebuildStatus | null },
  requireCleanRebuild: boolean,
): { label: string; tone: Tone } {
  if (request.status !== 'candidate') return { label: REQUEST_STATUS_LABEL[request.status], tone: requestTone(request.status) };
  if (!request.upToDate) return { label: 'Needs regenerating', tone: 'caution' };
  if (request.rebuildStatus === 'failed') return { label: 'Rebuild failed', tone: 'danger' };
  if (requireCleanRebuild && !request.rebuildStatus) return { label: 'Waiting for rebuild', tone: 'open' };
  return { label: REQUEST_STATUS_LABEL.candidate, tone: 'open' };
}

export const REBUILD_STATUS_LABEL: Record<RebuildStatus, string> = {
  passed: 'Passed',
  passed_with_warnings: 'Passed with warnings',
  failed: 'Failed',
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
      return `Needs ${blocker.need - blocker.have} more approval${blocker.need - blocker.have === 1 ? '' : 's'}.`;
    case 'not_enough_eligible_approvers':
      return `Only ${blocker.eligible} of the ${blocker.need} required approvers can approve this request.`;
    case 'rebuild_missing':
      return 'Needs a clean SolidWorks rebuild of this candidate.';
    case 'rebuild_stale':
      return 'The rebuild report is for an older candidate. It needs a new rebuild.';
    case 'rebuild_failed':
      return 'The SolidWorks rebuild of this candidate failed.';
  }
}

/** Who may approve under the rules, in words: "an owner, a maintainer or @kim". `handles` names people by user id. */
export function approverText(rules: ApprovalRules, handles: ReadonlyMap<string, string> = new Map()): string {
  const roles = rules.approverRoles.map((role) => `${role === 'owner' ? 'an' : 'a'} ${role}`);
  const named = rules.approverUserIds.map((id) => handles.get(id)).filter((handle): handle is string => Boolean(handle));
  const people = named.length === rules.approverUserIds.length ? named.map((handle) => `@${handle}`) : rules.approverUserIds.length ? ['someone named in the rules'] : [];
  const who = [...roles, ...people];
  return who.length === 0 ? 'no one' : who.length === 1 ? who[0]! : `${who.slice(0, -1).join(', ')} or ${who.at(-1)}`;
}

/** The approval rule in one line, for the top of the Approvals card. */
export function ruleSummary(rules: ApprovalRules, handles?: ReadonlyMap<string, string>): string {
  if (rules.requiredCount === 0) return 'No approval is needed to release.';
  const count = rules.requiredCount === 1 ? '1 approval' : `${rules.requiredCount} approvals`;
  return `Needs ${count} from ${approverText(rules, handles)}. ${rules.allowSelfApproval ? 'The requester can approve too.' : 'The requester can’t approve their own request.'}`;
}

/** A pick warning as a sentence, naming every file it is about. */
export function warningText(warning: CandidateWarning): string {
  switch (warning.kind) {
    case 'overwrites_main_change':
      return `${warning.path} takes the branch’s version over a newer change on main.`;
    case 'discards_branch_change':
      return `${warning.path} keeps main’s version, so the branch’s change to it is left out.`;
    case 'replacement_discards_branch_change':
      return `${warning.toPath} replaces ${warning.path}, so the branch’s edit to ${warning.path} is left out.`;
    case 'missing_reference':
      return `${warning.path} references ${warning.referencedPath}, which isn’t in the release.`;
    case 'mixed_sources':
      return `${warning.path} comes from the branch but references ${warning.referencedPath}, which keeps main’s version.`;
    case 'needs_repoint':
      return `${warning.path} references ${warning.fromPath}, which ${warning.toPath} replaces. The SolidWorks rebuild must repoint it.`;
  }
}

/** A pick error as a sentence. `pathOf` names items by path where it can. */
export function errorText(error: CandidateError, pathOf: (itemId: string) => string | undefined): string {
  switch (error.kind) {
    case 'unknown_item':
      return `A saved pick names a file that isn’t in this request’s changes (${pathOf(error.itemId) ?? `item ${error.itemId.slice(0, 8)}`}). Save your picks to drop it.`;
    case 'invalid_replacement':
      return `${pathOf(error.branchItemId) ?? 'A new file'} can’t replace ${pathOf(error.mainItemId) ?? 'that main file'}: ${error.reason}.`;
    case 'path_collision':
      return `${error.itemIds.length} files would end up at ${error.path}. Keep only one of them.`;
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
  const changes = Object.entries(payload).filter(([field]) => PROJECT_FIELDS[field]);
  // Older events recorded every field the form sent, changed or not, so they can't say what changed.
  if (changes.length === 0 || changes.some(([, value]) => !value || typeof value !== 'object' || !('to' in value))) return 'changed the project settings';
  const parts = changes.map(([field, value]) => {
    const to = (value as { to: unknown }).to;
    if (field === 'visibility') return `made the project ${String(to)}`;
    if (field === 'name') return `renamed the project to ${String(to)}`;
    if (field === 'license') return to ? `set the license to ${String(to)}` : 'removed the license';
    return `changed the ${PROJECT_FIELDS[field]}`;
  });
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
    case 'project_created': {
      const from = payload.forkedFrom as { ownerHandle?: string; slug?: string; releaseNumber?: number } | string | undefined;
      return [typeof from === 'object' && from?.ownerHandle ? `${who} forked @${from.ownerHandle}/${from.slug} v${from.releaseNumber}` : `${who} created the project`];
    }
    case 'project_forked': {
      const fork = payload.fork as { ownerHandle?: string; slug?: string } | undefined;
      return [`${who} forked v${String(payload.releaseNumber)} into ${fork?.ownerHandle}/${fork?.slug}`];
    }
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
      const lock = holder ? `${holder}’s lock` : 'the lock';
      // Archiving a branch, or removing someone from the project, releases their lock too.
      if (payload.reason === 'archived') return [`${who} released ${lock} on `, branch(branchName), ' by archiving it'];
      if (payload.reason === 'member_removed') return [`${who} released ${lock} on `, branch(branchName), ', since they can no longer save to it'];
      return [`${who} force-released ${lock} on `, branch(branchName)];
    }
    case 'branch_archived':
      return [`${who} archived `, branch(branchName)];
    case 'branch_unarchived':
      return [`${who} restored `, branch(branchName), ' from the archive'];
    case 'commit_created': {
      if (payload.kind !== 'version') return undefined;
      const label = payload.versionLabel ? `version ${String(payload.versionLabel)}` : 'a version';
      const version: Segment = names.href && typeof payload.commitId === 'string' ? { text: label, href: names.href.commit(payload.commitId) } : label;
      return [`${who} committed `, version, ' on ', branch(branchName)];
    }
    case 'release_request_opened':
      return [`${who} opened release request `, request()];
    case 'release_request_picks_changed':
      return [`${who} changed the picks on `, request(), ', which resets its approvals'];
    case 'release_request_candidate_generated':
      return [`${who} built the candidate for `, request()];
    case 'release_request_candidate_updated': {
      const count = Number(payload.changedFiles ?? 0);
      return [`${who} saved ${count === 1 ? 'a rebuilt file' : `${count} rebuilt files`} into the candidate for `, request(), ', which resets its approvals'];
    }
    case 'release_request_rebuild_reported':
      return [`${who} reported a ${String(payload.status).replace(/_/g, ' ')} rebuild of `, request()];
    case 'release_request_approved':
      return [`${who} approved the candidate for `, request()];
    case 'release_request_approval_withdrawn':
      return [`${who} withdrew their approval of `, request()];
    case 'release_request_closed':
      return [`${who} closed `, request()];
    case 'release_created': {
      const number = Number(payload.number);
      const text = releaseName({ number, title: names.release?.(number) ?? (typeof payload.title === 'string' ? payload.title : null) });
      return [`${who} released `, names.href ? { text, href: names.href.release(number) } : text];
    }
    case 'export_attached':
    case 'export_replaced':
      return [`${who} ${event.kind === 'export_replaced' ? 'replaced the' : 'attached a'} ${String(payload.format).toUpperCase()} export of ${String(payload.path ?? 'a SolidWorks file')}`];
    case 'member_changed':
      if (payload.left) return [`${who} left the project`];
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
