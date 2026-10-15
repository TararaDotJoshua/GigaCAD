// What deserves a system notification while the window is hidden, and the count of things that
// need the person (desktop UX plan, phase 8). Pure: the controller keeps the last snapshot and
// shows what these return.
import type { AppState, Approval, NotifyKinds, ProjectState } from '../shared/types.js';

/** What we compare between two states. */
export interface Snapshot {
  /** `projectId:branch` → holder handle, for downloaded branches someone else holds. */
  readonly othersHolding: ReadonlyMap<string, string>;
  /** `projectId:path` of each conflict. */
  readonly conflicts: ReadonlySet<string>;
  /** `projectId:number` of each request waiting for the person's approval. */
  readonly approvals: ReadonlySet<string>;
}

export interface Notice {
  readonly kind: keyof NotifyKinds;
  readonly title: string;
  readonly body: string;
  /** Where clicking it opens the window. */
  readonly projectId: string;
  readonly branch?: string;
}

export function snapshot(projects: readonly ProjectState[], approvals: readonly Approval[]): Snapshot {
  const othersHolding = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const project of projects) {
    if (project.hidden) continue;
    for (const branch of project.branches) {
      if (branch.downloaded && branch.holder === 'other') othersHolding.set(`${project.id}:${branch.name}`, branch.holderHandle ?? 'someone');
    }
    for (const conflict of project.conflicts) conflicts.add(`${project.id}:${conflict.path}`);
  }
  return { othersHolding, conflicts, approvals: new Set(approvals.map((approval) => `${approval.projectId}:${approval.number}`)) };
}

/** What's new since the last snapshot. The first snapshot (null) only sets the baseline. */
export function notices(previous: Snapshot | null, next: Snapshot, projects: readonly ProjectState[], approvals: readonly Approval[], kinds: NotifyKinds): Notice[] {
  if (!previous) return [];
  const name = (projectId: string) => projects.find((project) => project.id === projectId)?.name ?? 'a project';
  const found: Notice[] = [];
  if (kinds.conflicts) {
    for (const key of next.conflicts) {
      if (previous.conflicts.has(key)) continue;
      const [projectId, ...path] = key.split(':');
      found.push({ kind: 'conflicts', title: `Conflict in ${name(projectId!)}`, body: `${path.join(':')} changed here and on gigacad.site. Your version was kept as a copy.`, projectId: projectId! });
    }
  }
  if (kinds.approvals) {
    for (const approval of approvals) {
      if (previous.approvals.has(`${approval.projectId}:${approval.number}`)) continue;
      found.push({
        kind: 'approvals',
        title: `#${approval.number} needs your approval`,
        body: `${approval.title} · ${approval.branchName} in ${name(approval.projectId)}`,
        projectId: approval.projectId,
      });
    }
  }
  if (kinds.checkouts) {
    for (const [key, handle] of next.othersHolding) {
      if (previous.othersHolding.get(key) === handle) continue;
      const [projectId, ...branch] = key.split(':');
      found.push({ kind: 'checkouts', title: `@${handle} checked out ${branch.join(':')}`, body: `In ${name(projectId!)}. Your copy stays read-only until they check it in.`, projectId: projectId!, branch: branch.join(':') });
    }
  }
  return found;
}

/** Conflicts, approvals waiting for you, and failed setup steps: one number for the Dock and taskbar. */
export function needsYouCount(state: Pick<AppState, 'projects' | 'approvals' | 'setup'>): number {
  const conflicts = state.projects.filter((project) => !project.hidden).reduce((total, project) => total + project.conflicts.length, 0);
  return conflicts + state.approvals.length + state.setup.filter((step) => step.status === 'error').length;
}

/** When a pause chosen now ends: in an hour, at 8 tomorrow morning, or never (until resumed). */
export function pauseEnd(duration: 'hour' | 'tomorrow' | null, now = new Date()): string | null {
  if (duration === 'hour') return new Date(now.getTime() + 60 * 60_000).toISOString();
  if (duration === 'tomorrow') {
    const end = new Date(now);
    end.setDate(end.getDate() + 1);
    end.setHours(8, 0, 0, 0);
    return end.toISOString();
  }
  return null;
}
