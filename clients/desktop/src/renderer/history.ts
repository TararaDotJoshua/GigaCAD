/** A commit from GET /v1/branches/:id/commits, newest first. */
export interface Commit {
  readonly id: string;
  readonly kind: 'autosave' | 'version';
  readonly message: string;
  readonly versionLabel: string | null;
  readonly authorHandle: string | null;
  readonly createdAt: string;
}

export interface HistoryRow {
  readonly key: string;
  readonly version?: Commit;
  readonly autosaves?: readonly Commit[];
}

/** Versions, with each run of autosaves between them folded into one row. */
export function groupHistory(commits: readonly Commit[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const commit of commits) {
    const last = rows.at(-1);
    if (commit.kind === 'autosave' && last?.autosaves) rows[rows.length - 1] = { key: last.key, autosaves: [...last.autosaves, commit] };
    else if (commit.kind === 'autosave') rows.push({ key: commit.id, autosaves: [commit] });
    else rows.push({ key: commit.id, version: commit });
  }
  return rows;
}
