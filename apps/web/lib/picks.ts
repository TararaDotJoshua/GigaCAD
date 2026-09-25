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

/** Only overrides are sent: actions that differ from the row's default, plus replacements. */
export function picksFromDraft(rows: readonly PickRow[], draft: DraftPicks): Picks {
  const actions: Record<string, PickAction> = {};
  const replacements: { branchItemId: string; mainItemId: string }[] = [];
  for (const row of rows) {
    const pick = draft[row.itemId];
    if (!pick) continue;
    if (pick.kind === 'replace') replacements.push({ branchItemId: row.itemId, mainItemId: pick.mainItemId });
    else if (pick.action !== row.defaultAction) actions[row.itemId] = pick.action;
  }
  return { actions, replacements };
}

export function samePicks(rows: readonly PickRow[], a: DraftPicks, b: DraftPicks): boolean {
  return JSON.stringify(picksFromDraft(rows, a)) === JSON.stringify(picksFromDraft(rows, b));
}
