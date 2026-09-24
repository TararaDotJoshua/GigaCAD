import {
  diffManifests,
  indexByItem,
  sameEntry,
  sortManifest,
  validateManifest,
  type ItemChange,
  type ItemId,
  type Manifest,
  type ManifestEntry,
  type Sha256,
} from './manifest.js';
import { comparePaths, InvalidPathError, pathKey } from './paths.js';

export type PickAction = 'take_branch' | 'keep_main';

/** A new branch item takes over an existing main item's identity (and its history). */
export interface Replacement {
  readonly branchItemId: ItemId;
  readonly mainItemId: ItemId;
}

export interface Picks {
  /** Overrides for the per-row default action. */
  readonly actions?: Readonly<Record<ItemId, PickAction>>;
  readonly replacements?: readonly Replacement[];
}

/** One line of the release request's diff-pick table. */
export interface PickRow {
  readonly itemId: ItemId;
  readonly path: string;
  /** Change from the branch's base release to the branch head. */
  readonly branchChange: ItemChange | undefined;
  /** Change from the branch's base release to the latest main release. */
  readonly mainChange: ItemChange | undefined;
  /** Both sides changed the item and ended up different. */
  readonly conflict: boolean;
  readonly defaultAction: PickAction;
}

export interface ReleaseInputs {
  /** The release the branch was created from. */
  readonly base: Manifest;
  readonly branchHead: Manifest;
  readonly latestMain: Manifest;
}

/** Project-relative paths each file references, keyed by the file's blob (e.g. from SolidWorks `GetDependencies2`). */
export type FileReferences = ReadonlyMap<Sha256, readonly string[]>;

export interface CandidateInputs extends ReleaseInputs {
  readonly picks?: Picks;
  readonly references?: FileReferences;
}

export interface AppliedReplacement {
  readonly mainItemId: ItemId;
  readonly branchItemId: ItemId;
  readonly fromPath: string;
  readonly toPath: string;
}

export type CandidateWarning =
  | { readonly kind: 'overwrites_main_change'; readonly itemId: ItemId; readonly path: string }
  | { readonly kind: 'discards_branch_change'; readonly itemId: ItemId; readonly path: string }
  | { readonly kind: 'missing_reference'; readonly itemId: ItemId; readonly path: string; readonly referencedPath: string }
  | {
      /** A file taken from the branch references a file whose branch changes are being discarded. */
      readonly kind: 'mixed_sources';
      readonly itemId: ItemId;
      readonly path: string;
      readonly referencedItemId: ItemId;
      readonly referencedPath: string;
    }
  | {
      /** A file references a replaced part; the SolidWorks rebuild step must repoint it. */
      readonly kind: 'needs_repoint';
      readonly itemId: ItemId;
      readonly path: string;
      readonly fromPath: string;
      readonly toPath: string;
    };

export type CandidateError =
  | { readonly kind: 'unknown_item'; readonly itemId: ItemId }
  | {
      readonly kind: 'invalid_replacement';
      readonly branchItemId: ItemId;
      readonly mainItemId: ItemId;
      readonly reason: string;
    }
  | { readonly kind: 'path_collision'; readonly path: string; readonly itemIds: readonly ItemId[] };

export interface Candidate {
  readonly manifest: Manifest;
  readonly rows: readonly PickRow[];
  readonly replacements: readonly AppliedReplacement[];
  readonly warnings: readonly CandidateWarning[];
  readonly errors: readonly CandidateError[];
  /** False when `errors` is non-empty; such a candidate must not be released. */
  readonly ok: boolean;
}

/** Every item that changed on the branch or on main since the branch was created. */
export function buildPickRows({ base, branchHead, latestMain }: ReleaseInputs): PickRow[] {
  const branchChanges = byItem(diffManifests(base, branchHead));
  const mainChanges = byItem(diffManifests(base, latestMain));
  const baseByItem = indexByItem(base);
  const head = indexByItem(branchHead);
  const main = indexByItem(latestMain);

  const rows: PickRow[] = [];
  for (const itemId of new Set([...branchChanges.keys(), ...mainChanges.keys()])) {
    const branchChange = branchChanges.get(itemId);
    const mainChange = mainChanges.get(itemId);
    const headEntry = head.get(itemId);
    const mainEntry = main.get(itemId);
    const entry = headEntry ?? mainEntry ?? baseByItem.get(itemId);
    if (!entry) throw new Error(`Changed item ${itemId} has no entry in any manifest`);

    rows.push({
      itemId,
      path: entry.path,
      branchChange,
      mainChange,
      conflict: branchChange !== undefined && mainChange !== undefined && !sameEntry(headEntry, mainEntry),
      defaultAction: branchChange ? 'take_branch' : 'keep_main',
    });
  }
  return rows.sort((a, b) => comparePaths(a.path, b.path));
}

/**
 * Builds the release candidate: the latest main release with the picked branch
 * changes applied on top. The branch wins wherever it is picked, even over newer
 * main changes; warnings flag those overwrites for reviewers.
 */
export function buildCandidate(inputs: CandidateInputs): Candidate {
  const { picks = {}, references = new Map<Sha256, readonly string[]>() } = inputs;
  const actions = picks.actions ?? {};
  const rows = buildPickRows(inputs);
  const rowItemIds = new Set(rows.map((row) => row.itemId));
  const head = indexByItem(inputs.branchHead);
  const main = indexByItem(inputs.latestMain);
  const errors: CandidateError[] = [];
  const warnings: CandidateWarning[] = [];

  for (const itemId of Object.keys(actions)) {
    if (!rowItemIds.has(itemId)) errors.push({ kind: 'unknown_item', itemId });
  }
  const replacements = validateReplacements(picks.replacements ?? [], head, main, actions, errors);
  const replacedItemIds = new Set(replacements.flatMap((r) => [r.mainItemId, r.branchItemId]));

  const result = new Map(main);
  const fromBranch = new Set<ItemId>();
  const branchChangeDiscarded = new Set<ItemId>();

  for (const row of rows) {
    if (replacedItemIds.has(row.itemId)) continue;
    const headEntry = head.get(row.itemId);
    const mainEntry = main.get(row.itemId);
    const action = actions[row.itemId] ?? row.defaultAction;

    if (action === 'take_branch') {
      if (headEntry) result.set(row.itemId, headEntry);
      else result.delete(row.itemId);
      fromBranch.add(row.itemId);
      if (row.mainChange && !sameEntry(headEntry, mainEntry)) {
        warnings.push({ kind: 'overwrites_main_change', itemId: row.itemId, path: row.path });
      }
    } else if (row.branchChange && !sameEntry(headEntry, mainEntry)) {
      branchChangeDiscarded.add(row.itemId);
      warnings.push({ kind: 'discards_branch_change', itemId: row.itemId, path: row.path });
    }
  }

  const applied: AppliedReplacement[] = [];
  for (const { mainItemId, branchItemId, mainEntry, branchEntry } of replacements) {
    result.set(mainItemId, { itemId: mainItemId, path: branchEntry.path, blob: branchEntry.blob });
    fromBranch.add(mainItemId);
    applied.push({ mainItemId, branchItemId, fromPath: mainEntry.path, toPath: branchEntry.path });
  }

  const manifest = sortManifest(result.values());
  for (const issue of validateManifest(manifest)) {
    if (issue.kind === 'duplicate_path') {
      errors.push({ kind: 'path_collision', path: issue.path, itemIds: issue.itemIds });
    }
  }
  warnings.push(...referenceWarnings(manifest, references, applied, fromBranch, branchChangeDiscarded));

  return { manifest, rows, replacements: applied, warnings, errors, ok: errors.length === 0 };
}

interface ValidReplacement extends Replacement {
  readonly mainEntry: ManifestEntry;
  readonly branchEntry: ManifestEntry;
}

function validateReplacements(
  requested: readonly Replacement[],
  head: ReadonlyMap<ItemId, ManifestEntry>,
  main: ReadonlyMap<ItemId, ManifestEntry>,
  actions: Readonly<Record<ItemId, PickAction>>,
  errors: CandidateError[],
): ValidReplacement[] {
  const valid: ValidReplacement[] = [];
  const usedMain = new Set<ItemId>();
  const usedBranch = new Set<ItemId>();

  for (const replacement of requested) {
    const { branchItemId, mainItemId } = replacement;
    const mainEntry = main.get(mainItemId);
    const branchEntry = head.get(branchItemId);
    let reason: string | undefined;

    if (branchItemId === mainItemId) reason = 'an item cannot replace itself';
    else if (!mainEntry) reason = 'the main item is not in the latest release';
    else if (!branchEntry) reason = 'the branch item is not in the branch';
    else if (main.has(branchItemId)) reason = 'only files that are new on the branch can replace a main item';
    else if (usedMain.has(mainItemId)) reason = 'the main item is already being replaced';
    else if (usedBranch.has(branchItemId)) reason = 'the branch item is already used in another replacement';
    else if (actions[mainItemId] !== undefined || actions[branchItemId] !== undefined) {
      reason = 'an item in a replacement cannot also have a pick action';
    }

    if (reason || !mainEntry || !branchEntry) {
      errors.push({ kind: 'invalid_replacement', branchItemId, mainItemId, reason: reason ?? 'invalid replacement' });
      continue;
    }
    usedMain.add(mainItemId);
    usedBranch.add(branchItemId);
    valid.push({ branchItemId, mainItemId, mainEntry, branchEntry });
  }
  return valid;
}

function referenceWarnings(
  manifest: Manifest,
  references: FileReferences,
  replacements: readonly AppliedReplacement[],
  fromBranch: ReadonlySet<ItemId>,
  branchChangeDiscarded: ReadonlySet<ItemId>,
): CandidateWarning[] {
  const warnings: CandidateWarning[] = [];
  const byPathKey = new Map(manifest.map((entry) => [pathKey(entry.path), entry]));
  const replacedByFromPath = new Map(replacements.map((r) => [pathKey(r.fromPath), r]));

  for (const entry of manifest) {
    for (const referencedPath of references.get(entry.blob) ?? []) {
      const key = tryPathKey(referencedPath);
      const replacement = key === undefined ? undefined : replacedByFromPath.get(key);
      const target = key === undefined ? undefined : byPathKey.get(key);

      if (replacement) {
        // Even at the same path, the new part is a different SolidWorks document and must be repointed.
        const { fromPath, toPath } = replacement;
        warnings.push({ kind: 'needs_repoint', itemId: entry.itemId, path: entry.path, fromPath, toPath });
      } else if (!target) {
        warnings.push({ kind: 'missing_reference', itemId: entry.itemId, path: entry.path, referencedPath });
      } else if (fromBranch.has(entry.itemId) && branchChangeDiscarded.has(target.itemId)) {
        warnings.push({
          kind: 'mixed_sources',
          itemId: entry.itemId,
          path: entry.path,
          referencedItemId: target.itemId,
          referencedPath: target.path,
        });
      }
    }
  }
  return warnings;
}

function tryPathKey(path: string): string | undefined {
  try {
    return pathKey(path);
  } catch (error) {
    if (error instanceof InvalidPathError) return undefined;
    throw error;
  }
}

function byItem(changes: readonly ItemChange[]): Map<ItemId, ItemChange> {
  return new Map(changes.map((change) => [change.itemId, change]));
}
