import { comparePaths, InvalidPathError, normalizePath } from './paths.js';

export type Sha256 = string;
export type ItemId = string;

/** One file in a project snapshot. `itemId` is the file's stable identity across releases and renames. */
export interface ManifestEntry {
  readonly itemId: ItemId;
  readonly path: string;
  readonly blob: Sha256;
}

export type Manifest = readonly ManifestEntry[];

export type ManifestIssue =
  | { readonly kind: 'duplicate_item'; readonly itemId: ItemId }
  | { readonly kind: 'duplicate_path'; readonly path: string; readonly itemIds: readonly ItemId[] }
  | { readonly kind: 'invalid_path'; readonly itemId: ItemId; readonly path: string; readonly reason: string };

export type ItemChange =
  | { readonly kind: 'added'; readonly itemId: ItemId; readonly after: ManifestEntry }
  | { readonly kind: 'deleted'; readonly itemId: ItemId; readonly before: ManifestEntry }
  | {
      readonly kind: 'modified';
      readonly itemId: ItemId;
      readonly before: ManifestEntry;
      readonly after: ManifestEntry;
      readonly contentChanged: boolean;
      readonly moved: boolean;
    };

export function validateManifest(manifest: Manifest): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const seenItems = new Set<ItemId>();
  const byPathKey = new Map<string, ManifestEntry[]>();

  for (const entry of manifest) {
    if (seenItems.has(entry.itemId)) issues.push({ kind: 'duplicate_item', itemId: entry.itemId });
    seenItems.add(entry.itemId);

    let normalized: string;
    try {
      normalized = normalizePath(entry.path);
    } catch (error) {
      if (!(error instanceof InvalidPathError)) throw error;
      issues.push({ kind: 'invalid_path', itemId: entry.itemId, path: entry.path, reason: error.reason });
      continue;
    }
    if (normalized !== entry.path) {
      issues.push({ kind: 'invalid_path', itemId: entry.itemId, path: entry.path, reason: 'path is not normalized' });
      continue;
    }

    const key = normalized.toLowerCase();
    const group = byPathKey.get(key);
    if (group) group.push(entry);
    else byPathKey.set(key, [entry]);
  }

  for (const group of byPathKey.values()) {
    const [first] = group;
    if (first && group.length > 1) {
      issues.push({ kind: 'duplicate_path', path: first.path, itemIds: group.map((entry) => entry.itemId) });
    }
  }
  return issues;
}

export function indexByItem(manifest: Manifest): Map<ItemId, ManifestEntry> {
  const index = new Map<ItemId, ManifestEntry>();
  for (const entry of manifest) {
    if (index.has(entry.itemId)) throw new Error(`Manifest contains item ${entry.itemId} more than once`);
    index.set(entry.itemId, entry);
  }
  return index;
}

export function sameEntry(a: ManifestEntry | undefined, b: ManifestEntry | undefined): boolean {
  if (!a || !b) return a === b;
  return a.itemId === b.itemId && a.path === b.path && a.blob === b.blob;
}

export function changePath(change: ItemChange): string {
  return change.kind === 'deleted' ? change.before.path : change.after.path;
}

export function sortManifest(manifest: Iterable<ManifestEntry>): ManifestEntry[] {
  return [...manifest].sort((a, b) => comparePaths(a.path, b.path));
}

/** Item-level diff: a rename keeps its item and shows up as a `modified` change with `moved: true`. */
export function diffManifests(before: Manifest, after: Manifest): ItemChange[] {
  const beforeByItem = indexByItem(before);
  const afterByItem = indexByItem(after);
  const changes: ItemChange[] = [];

  for (const [itemId, previous] of beforeByItem) {
    const next = afterByItem.get(itemId);
    if (!next) {
      changes.push({ kind: 'deleted', itemId, before: previous });
    } else if (!sameEntry(previous, next)) {
      changes.push({
        kind: 'modified',
        itemId,
        before: previous,
        after: next,
        contentChanged: previous.blob !== next.blob,
        moved: previous.path !== next.path,
      });
    }
  }
  for (const [itemId, next] of afterByItem) {
    if (!beforeByItem.has(itemId)) changes.push({ kind: 'added', itemId, after: next });
  }

  return changes.sort((a, b) => comparePaths(changePath(a), changePath(b)));
}
