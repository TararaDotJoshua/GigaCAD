import { diffManifests, pathKey, type ItemChange, type ManifestEntry } from '@gigacad/core';
import type { WorkspaceState } from './workspace.js';

/** Files without an item yet get a placeholder id, so core's item diff can describe them. */
const NEW_ITEM = 'new:';
export const isNewItem = (itemId: string) => itemId.startsWith(NEW_ITEM);

export interface LocalFile {
  readonly path: string;
  readonly blob: string;
}

/** The working tree as a manifest: tracked files keep their item id (following `giga mv`), others are new. */
export function workingManifest(state: Pick<WorkspaceState, 'tracked'>, files: readonly LocalFile[]): ManifestEntry[] {
  const trackedByKey = new Map(Object.entries(state.tracked).map(([path, itemId]) => [pathKey(path), itemId]));
  return files.map((file) => ({
    path: file.path,
    blob: file.blob,
    itemId: trackedByKey.get(pathKey(file.path)) ?? `${NEW_ITEM}${file.path}`,
  }));
}

export type LocalChange =
  | { readonly kind: 'added'; readonly path: string }
  | { readonly kind: 'deleted'; readonly path: string; readonly itemId: string }
  | { readonly kind: 'modified'; readonly path: string; readonly itemId: string }
  | { readonly kind: 'moved'; readonly path: string; readonly from: string; readonly itemId: string; readonly modified: boolean };

/** What changed locally since the last sync, per item: renames made with `giga mv` show as moves. */
export function localChanges(state: Pick<WorkspaceState, 'base' | 'tracked'>, files: readonly LocalFile[]): LocalChange[] {
  return diffManifests(state.base, workingManifest(state, files)).map(describeChange);
}

function describeChange(change: ItemChange): LocalChange {
  switch (change.kind) {
    case 'added':
      return { kind: 'added', path: change.after.path };
    case 'deleted':
      return { kind: 'deleted', path: change.before.path, itemId: change.itemId };
    case 'modified':
      return change.moved
        ? { kind: 'moved', path: change.after.path, from: change.before.path, itemId: change.itemId, modified: change.contentChanged }
        : { kind: 'modified', path: change.after.path, itemId: change.itemId };
  }
}

/** The commit body's file list. New files have no item id; the server assigns one. */
export function commitFiles(state: Pick<WorkspaceState, 'tracked'>, files: readonly LocalFile[]) {
  return workingManifest(state, files).map((entry) => ({
    path: entry.path,
    blob: entry.blob,
    ...(isNewItem(entry.itemId) ? {} : { itemId: entry.itemId }),
  }));
}

export interface PullPlan {
  /** Paths where a remote change would overwrite or delete local work. Nothing is applied when non-empty. */
  readonly conflicts: readonly { readonly path: string; readonly reason: string }[];
  readonly writes: readonly ManifestEntry[];
  readonly deletes: readonly string[];
  /** The new `tracked` map after applying the plan. */
  readonly tracked: Record<string, string>;
  readonly remoteChanges: number;
}

/**
 * Brings the workspace from its recorded base to `target` without losing local work.
 * Local edits to files the remote didn't touch are kept; anything else that would be
 * overwritten or deleted is reported as a conflict and nothing changes.
 */
export function planPull(state: Pick<WorkspaceState, 'base' | 'tracked'>, files: readonly LocalFile[], target: readonly ManifestEntry[]): PullPlan {
  const remote = diffManifests(state.base, target);
  if (remote.length === 0) return { conflicts: [], writes: [], deletes: [], tracked: { ...state.tracked }, remoteChanges: 0 };

  const local = localChanges(state, files);
  const conflicts: { path: string; reason: string }[] = [];
  // Local change kind by path key.
  const touched = new Map<string, LocalChange['kind']>();
  for (const change of local) {
    if (change.kind === 'moved') {
      conflicts.push({ path: change.path, reason: `moved from ${change.from}; commit or undo the move first` });
      touched.set(pathKey(change.from), change.kind);
    }
    touched.set(pathKey(change.path), change.kind);
  }
  const workingByKey = new Map(files.map((file) => [pathKey(file.path), file]));

  const writes: ManifestEntry[] = [];
  const deletes: string[] = [];
  for (const change of remote) {
    const before = change.kind === 'added' ? undefined : change.before;
    const after = change.kind === 'deleted' ? undefined : change.after;
    const localKind = before ? touched.get(pathKey(before.path)) : undefined;
    // A local deletion loses nothing if the branch's version comes back (or is deleted too).
    if (localKind && localKind !== 'deleted') {
      conflicts.push({ path: before!.path, reason: 'changed locally and on the branch' });
      continue;
    }
    if (after && (!before || pathKey(before.path) !== pathKey(after.path))) {
      const occupant = workingByKey.get(pathKey(after.path));
      if (occupant && occupant.blob !== after.blob) {
        conflicts.push({ path: after.path, reason: 'a local file is in the way of a file from the branch' });
        continue;
      }
    }
    if (before && (!after || before.path !== after.path)) deletes.push(before.path);
    if (after && (!before || before.blob !== after.blob || before.path !== after.path)) writes.push(after);
  }

  return {
    conflicts,
    writes,
    deletes,
    tracked: Object.fromEntries(target.map((entry) => [entry.path, entry.itemId])),
    remoteChanges: remote.length,
  };
}
