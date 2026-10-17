import type { PickAction, PickRow, Picks } from '@gigacad/core';

/**
 * The pick table's editable state. Each row is either an action (take the branch's
 * version or keep main's) or, for a file new on the branch, "replace" an existing
 * main file, which then keeps that file's identity and history.
 */
export type RowPick = { readonly kind: 'action'; readonly action: PickAction } | { readonly kind: 'replace'; readonly mainItemId: string };

export type DraftPicks = Readonly<Record<string, RowPick>>;

/** A row that can replace a main file: the item is new on the branch. */
export function canReplace(row: PickRow): boolean {
  return row.branchChange?.kind === 'added';
}

/**
 * Main files a new branch file can replace. A file the branch edited is left out: replacing
 * it would silently drop that edit. Files the branch deleted are the usual thing to replace.
 */
export function replaceableFiles<T extends { itemId: string }>(mainFiles: readonly T[], rows: readonly PickRow[]): T[] {
  const edited = new Set(rows.filter((row) => row.branchChange?.kind === 'modified').map((row) => row.itemId));
  return mainFiles.filter((file) => !edited.has(file.itemId));
}

/** Rows whose main item a new branch file is replacing, and the path that replaces each. */
export function replacedBy(rows: readonly PickRow[], draft: DraftPicks): Map<string, string> {
  const replaced = new Map<string, string>();
  for (const row of rows) {
    const pick = draft[row.itemId];
    if (pick?.kind === 'replace') replaced.set(pick.mainItemId, row.path);
  }
  return replaced;
}

/**
 * The two choices for a row, named for what they do to main. A file only main changed has
 * nothing new from the branch: "taking the branch" there removes, restores, or reverts it.
 */
export function pickChoices(row: PickRow, numbers: { base: number | null; latest: number | null }): { take: string; keep: string } {
  const latest = numbers.latest ? `v${numbers.latest}` : 'main';
  const base = numbers.base ? `v${numbers.base}` : 'the base';
  if (row.branchChange) {
    return { take: row.branchChange.kind === 'added' ? 'Add as new' : row.branchChange.kind === 'deleted' ? 'Remove' : 'Take branch', keep: 'Keep main' };
  }
  switch (row.mainChange?.kind) {
    case 'added':
      return { take: 'Remove', keep: `Keep ${latest}` };
    case 'deleted':
      return { take: `Restore from ${base}`, keep: 'Keep removed' };
    default:
      return { take: `Revert to ${base}`, keep: `Keep ${latest}` };
  }
}

/** A row's pick in words, for read-only views: the same names the editor's buttons use. */
export function pickLabel(row: PickRow, pick: RowPick, numbers: { base: number | null; latest: number | null }, pathOf: (itemId: string) => string | undefined): string {
  if (pick.kind === 'replace') return `Replaces ${pathOf(pick.mainItemId) ?? 'a main file'}`;
  const choices = pickChoices(row, numbers);
  return pick.action === 'take_branch' ? choices.take : choices.keep;
}

/** True when the saved picks hold entries the table can't show, like picks for items that aren't rows. Saving drops them. */
export function hasStrayPicks(rows: readonly PickRow[], saved: Picks): boolean {
  const clean = picksFromDraft(rows, draftFromPicks(rows, saved));
  const actions = Object.entries(saved.actions ?? {}).length;
  return actions !== Object.keys(clean.actions ?? {}).length || (saved.replacements ?? []).length !== (clean.replacements ?? []).length;
}

export function draftFromPicks(rows: readonly PickRow[], picks: Picks): DraftPicks {
  const replacing = new Map((picks.replacements ?? []).map((replacement) => [replacement.branchItemId, replacement.mainItemId]));
  return Object.fromEntries(
    rows.map((row) => {
      const mainItemId = replacing.get(row.itemId);
      const pick: RowPick = mainItemId
        ? { kind: 'replace', mainItemId }
        : { kind: 'action', action: picks.actions?.[row.itemId] ?? row.defaultAction };
      return [row.itemId, pick];
    }),
  );
}

/**
 * Only overrides are sent: actions that differ from the row's default, plus replacements.
 * A row whose item is being replaced takes no action of its own; the replacement decides it.
 */
export function picksFromDraft(rows: readonly PickRow[], draft: DraftPicks): Picks {
  const actions: Record<string, PickAction> = {};
  const replacements: { branchItemId: string; mainItemId: string }[] = [];
  const replaced = replacedBy(rows, draft);
  for (const row of rows) {
    const pick = draft[row.itemId];
    if (!pick || replaced.has(row.itemId)) continue;
    if (pick.kind === 'replace') replacements.push({ branchItemId: row.itemId, mainItemId: pick.mainItemId });
    else if (pick.action !== row.defaultAction) actions[row.itemId] = pick.action;
  }
  return { actions, replacements };
}

export function samePicks(rows: readonly PickRow[], a: DraftPicks, b: DraftPicks): boolean {
  return JSON.stringify(picksFromDraft(rows, a)) === JSON.stringify(picksFromDraft(rows, b));
}

export interface PickOutcome {
  readonly edited: number;
  readonly added: number;
  readonly removed: number;
  /** New branch files taking the place (and history) of a main file. */
  readonly replaced: number;
  /** Files only main changed, put back the way the branch's base had them. */
  readonly reverted: number;
  /** Files main removed, brought back from the branch's base. */
  readonly restored: number;
}

/** What the picks do to main, counted: the numbers behind "v3 will change 3 files". */
export function pickOutcome(rows: readonly PickRow[], draft: DraftPicks): PickOutcome {
  const outcome = { edited: 0, added: 0, removed: 0, replaced: 0, reverted: 0, restored: 0 };
  const replaced = replacedBy(rows, draft);
  for (const row of rows) {
    // A replaced main file is counted once, as the replacement.
    if (replaced.has(row.itemId)) continue;
    const pick = draft[row.itemId] ?? { kind: 'action', action: row.defaultAction };
    if (pick.kind === 'replace') outcome.replaced++;
    else if (pick.action === 'take_branch') {
      const change = row.branchChange ?? row.mainChange;
      // Without a branch change, taking the branch undoes main's: a new main file goes, a removed one comes back.
      const kind = row.branchChange ? change?.kind : change?.kind === 'added' ? 'deleted' : change?.kind === 'deleted' ? 'restored' : 'reverted';
      if (kind === 'added') outcome.added++;
      else if (kind === 'deleted') outcome.removed++;
      else if (kind === 'restored') outcome.restored++;
      else if (kind === 'reverted') outcome.reverted++;
      else outcome.edited++;
    }
  }
  return outcome;
}

export function outcomeText(outcome: PickOutcome): string {
  const total = outcome.edited + outcome.added + outcome.removed + outcome.replaced + outcome.reverted + outcome.restored;
  if (total === 0) return 'no files: main stays as it is';
  const parts = [
    [outcome.edited, 'edited'],
    [outcome.added, 'added'],
    [outcome.removed, 'removed'],
    [outcome.replaced, 'replacing a main file'],
    [outcome.reverted, 'reverted'],
    [outcome.restored, 'restored'],
  ].flatMap(([n, word]) => (n ? [`${n} ${word}`] : []));
  return `${total} ${total === 1 ? 'file' : 'files'}: ${parts.join(', ')}`;
}
