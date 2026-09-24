export type CommitKind = 'autosave' | 'version';

export interface BranchCommit {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: CommitKind;
}

export type PruneTrigger = 'version' | 'release';

export interface AutosavePrunePlan {
  /** Oldest first. */
  readonly deleteIds: readonly string[];
  /** Kept commits whose parent is being deleted, relinked to their nearest kept ancestor. */
  readonly reparent: readonly { readonly commitId: string; readonly newParentId: string | null }[];
  readonly newHeadId: string | null;
}

/**
 * Autosaves are temporary. Committing a version removes the autosaves that came
 * before it; releasing the branch removes every autosave on it.
 */
export function planAutosavePrune(
  commits: readonly BranchCommit[],
  headId: string,
  trigger: PruneTrigger,
): AutosavePrunePlan {
  const newestFirst = historyFrom(commits, headId);
  const newestVersionIndex = newestFirst.findIndex((commit) => commit.kind === 'version');
  const shouldDelete = (commit: BranchCommit, index: number): boolean =>
    commit.kind === 'autosave' &&
    (trigger === 'release' || (newestVersionIndex !== -1 && index > newestVersionIndex));

  const deleteIds: string[] = [];
  const reparent: { commitId: string; newParentId: string | null }[] = [];
  let lastKeptId: string | null = null;

  for (let index = newestFirst.length - 1; index >= 0; index--) {
    const commit = newestFirst[index]!;
    if (shouldDelete(commit, index)) {
      deleteIds.push(commit.id);
      continue;
    }
    if (commit.parentId !== lastKeptId) reparent.push({ commitId: commit.id, newParentId: lastKeptId });
    lastKeptId = commit.id;
  }

  return { deleteIds, reparent, newHeadId: lastKeptId };
}

/** The branch's linear history, head first. */
function historyFrom(commits: readonly BranchCommit[], headId: string): BranchCommit[] {
  const byId = new Map(commits.map((commit) => [commit.id, commit]));
  const history: BranchCommit[] = [];
  const seen = new Set<string>();

  for (let id: string | null = headId; id !== null; ) {
    const commit = byId.get(id);
    if (!commit) throw new Error(`Commit ${id} is missing from the branch history`);
    if (seen.has(id)) throw new Error(`Branch history loops back to commit ${id}`);
    seen.add(id);
    history.push(commit);
    id = commit.parentId;
  }
  return history;
}
