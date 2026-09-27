import { pathKey } from '@gigacad/core';

/** A root file as last synced, or as the server has it now. `entryId` is its identity across renames. */
export interface RootFile {
  readonly entryId: string;
  readonly path: string;
  readonly blob: string;
}

export interface RootFolder {
  readonly entryId: string;
  readonly path: string;
}

export interface RootSnapshot {
  readonly files: readonly RootFile[];
  readonly folders: readonly RootFolder[];
}

export interface LocalTree {
  readonly files: readonly { readonly path: string; readonly blob: string }[];
  readonly folders: readonly string[];
}

export interface PathBlob {
  readonly path: string;
  readonly blob: string;
}

export interface Rename {
  readonly from: string;
  readonly to: string;
}

/**
 * What a sync does. The local half is applied first (pull), then the server half (push).
 * Nothing is ever overwritten without a copy: when both sides changed a file differently,
 * the local version is renamed to "<name> (conflict).<ext>" and uploaded as a new file.
 */
export interface RootPlan {
  // Here
  readonly localFolders: readonly string[];
  readonly localMoves: readonly Rename[];
  readonly conflictCopies: readonly Rename[];
  readonly localDeletes: readonly string[];
  readonly downloads: readonly PathBlob[];
  /** Folders the server deleted; removed here once nothing that's kept is left in them. */
  readonly removeLocalFolders: readonly string[];
  // On the server
  readonly createFolders: readonly string[];
  readonly moves: readonly (Rename & { readonly entryId: string })[];
  readonly replaces: readonly (PathBlob & { readonly entryId: string })[];
  readonly creates: readonly PathBlob[];
  readonly deleteFiles: readonly RootFile[];
  readonly deleteFolders: readonly RootFolder[];
}

const key = pathKey;
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const depth = (path: string) => path.split('/').length;

function ancestors(path: string): string[] {
  const out: string[] = [];
  for (let parent = parentOf(path); parent !== ''; parent = parentOf(parent)) out.push(parent);
  return out;
}

/** "parts/Arm (conflict).SLDPRT", then "(conflict 2)" and so on, avoiding every taken path. */
export function conflictName(path: string, taken: ReadonlySet<string>): string {
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 1; ; n++) {
    const candidate = `${dir}${stem} (conflict${n === 1 ? '' : ` ${n}`})${ext}`;
    if (!taken.has(key(candidate))) return candidate;
  }
}

export function planRootSync(base: RootSnapshot, local: LocalTree, remote: RootSnapshot): RootPlan {
  const localFolders: string[] = [];
  const localMoves: Rename[] = [];
  const conflictCopies: Rename[] = [];
  const localDeletes: string[] = [];
  const downloads: PathBlob[] = [];
  const moves: (Rename & { entryId: string })[] = [];
  const replaces: (PathBlob & { entryId: string })[] = [];
  const creates: PathBlob[] = [];
  const deleteFiles: RootFile[] = [];

  const localByKey = new Map(local.files.map((file) => [key(file.path), file]));
  const remoteById = new Map(remote.files.map((file) => [file.entryId, file]));
  const baseIds = new Set(base.files.map((file) => file.entryId));
  const baseKeys = new Set(base.files.map((file) => key(file.path)));
  const remoteNew = remote.files.filter((file) => !baseIds.has(file.entryId));
  const remoteNewByKey = new Map(remoteNew.map((file) => [key(file.path), file]));
  const taken = new Set([...local.files, ...remote.files].map((file) => key(file.path)));
  const handledRemoteNew = new Set<string>();

  /** Keep the local file as a new "(conflict)" copy and put the server's file at `path`. */
  const conflict = (path: string, localBlob: string, theirs: PathBlob) => {
    const aside = conflictName(path, taken);
    taken.add(key(aside));
    conflictCopies.push({ from: path, to: aside });
    creates.push({ path: aside, blob: localBlob });
    downloads.push({ path: theirs.path, blob: theirs.blob });
  };

  // Local files at paths that weren't synced: new files, or where a synced file was renamed to.
  const fresh = local.files.filter((file) => !baseKeys.has(key(file.path)));
  const renameTargets = new Set<string>();
  const mineById = new Map<string, PathBlob | undefined>();
  for (const synced of base.files) {
    const here = localByKey.get(key(synced.path));
    if (here) {
      mineById.set(synced.entryId, here);
      continue;
    }
    // Finder renames look like a delete plus an add; the same contents under a new name is a rename.
    const renamed = fresh.find((file) => !renameTargets.has(key(file.path)) && file.blob === synced.blob);
    if (renamed) renameTargets.add(key(renamed.path));
    mineById.set(synced.entryId, renamed);
  }

  for (const synced of base.files) {
    const mine = mineById.get(synced.entryId);
    const theirs = remoteById.get(synced.entryId);

    if (!theirs) {
      // Deleted on the server.
      if (!mine) continue;
      if (mine.blob === synced.blob) {
        localDeletes.push(mine.path);
        continue;
      }
      // Edited here: keep the edit as a new file, unless the server has a new file at that path.
      const occupant = remoteNewByKey.get(key(mine.path));
      if (occupant) {
        handledRemoteNew.add(occupant.entryId);
        if (occupant.blob !== mine.blob) conflict(mine.path, mine.blob, occupant);
      } else {
        creates.push(mine);
      }
      continue;
    }

    const remoteMoved = theirs.path !== synced.path;
    const remoteChanged = theirs.blob !== synced.blob;
    if (!mine) {
      // Deleted here: the server's newer contents win; otherwise the delete goes up.
      if (remoteChanged || remoteMoved) downloads.push({ path: theirs.path, blob: theirs.blob });
      else deleteFiles.push(synced);
      continue;
    }

    let path = mine.path;
    const localMoved = mine.path !== synced.path;
    if (remoteMoved && mine.path !== theirs.path) {
      // The server's rename wins; if something here already sits at its new name, try again next sync.
      if (localByKey.has(key(theirs.path)) && key(theirs.path) !== key(mine.path)) continue;
      localMoves.push({ from: mine.path, to: theirs.path });
      path = theirs.path;
    } else if (localMoved && !remoteMoved) {
      moves.push({ entryId: synced.entryId, from: theirs.path, to: mine.path });
    }

    const localChanged = mine.blob !== synced.blob;
    if (!localChanged && remoteChanged) downloads.push({ path, blob: theirs.blob });
    else if (localChanged && !remoteChanged) replaces.push({ entryId: synced.entryId, path, blob: mine.blob });
    else if (localChanged && remoteChanged && mine.blob !== theirs.blob) conflict(path, mine.blob, { path, blob: theirs.blob });
  }

  for (const file of fresh) {
    if (renameTargets.has(key(file.path))) continue;
    const theirs = remoteNewByKey.get(key(file.path));
    if (!theirs) {
      creates.push(file);
      continue;
    }
    handledRemoteNew.add(theirs.entryId);
    if (theirs.blob !== file.blob) conflict(file.path, file.blob, theirs);
    // Same contents on both sides: nothing to do; the next state records it as synced.
  }
  for (const theirs of remoteNew) {
    if (handledRemoteNew.has(theirs.entryId)) continue;
    if (!localByKey.has(key(theirs.path))) downloads.push({ path: theirs.path, blob: theirs.blob });
  }

  // Folders.
  const localFolderKeys = new Set(local.folders.map(key));
  const baseFolderKeys = new Set(base.folders.map((folder) => key(folder.path)));
  const remoteFolderByKey = new Map(remote.folders.map((folder) => [key(folder.path), folder]));

  const deletedIds = new Set(deleteFiles.map((file) => file.entryId));
  const incoming = [...downloads, ...localMoves.map((move) => ({ path: move.to }))].map((item) => key(item.path));
  const deleteFolders: RootFolder[] = [];
  for (const folder of remote.folders) {
    const k = key(folder.path);
    if (localFolderKeys.has(k)) continue;
    if (!baseFolderKeys.has(k)) {
      localFolders.push(folder.path);
      continue;
    }
    // Deleted here since the last sync. Only delete it on the server if nothing new arrived in it there.
    const inside = (path: string) => key(path).startsWith(`${k}/`);
    const keptThere = remote.files.some((file) => inside(file.path) && !deletedIds.has(file.entryId));
    const keptFolder = remote.folders.some((other) => inside(other.path) && localFolderKeys.has(key(other.path)));
    if (keptThere || keptFolder || incoming.some((path) => path.startsWith(`${k}/`))) localFolders.push(folder.path);
    else deleteFolders.push(folder);
  }

  // Server folders that anything here still needs.
  const needed = new Map<string, string>();
  for (const path of local.folders) if (!remoteFolderByKey.has(key(path)) && !baseFolderKeys.has(key(path))) needed.set(key(path), path);
  for (const item of [...creates, ...moves.map((move) => ({ path: move.to }))]) {
    for (const parent of ancestors(item.path)) if (!remoteFolderByKey.has(key(parent))) needed.set(key(parent), parent);
  }
  const createFolders = [...needed.values()].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));

  const removeLocalFolders = base.folders
    .filter((folder) => !remoteFolderByKey.has(key(folder.path)) && localFolderKeys.has(key(folder.path)) && !needed.has(key(folder.path)))
    .map((folder) => folder.path)
    .sort((a, b) => depth(b) - depth(a));

  return {
    localFolders: localFolders.sort((a, b) => depth(a) - depth(b)),
    localMoves,
    conflictCopies,
    localDeletes,
    downloads,
    removeLocalFolders,
    createFolders,
    moves,
    replaces,
    creates,
    deleteFiles,
    deleteFolders: deleteFolders.sort((a, b) => depth(b.path) - depth(a.path)),
  };
}

/** Changes waiting to be pushed, from the last-synced state alone (no network). */
export function pendingRootChanges(base: RootSnapshot, local: LocalTree) {
  const plan = planRootSync(base, local, base);
  return {
    added: plan.creates.map((file) => file.path),
    modified: plan.replaces.map((file) => file.path),
    moved: plan.moves.map(({ from, to }) => ({ from, to })),
    deleted: plan.deleteFiles.map((file) => file.path),
    addedFolders: plan.createFolders,
    deletedFolders: plan.deleteFolders.map((folder) => folder.path),
  };
}

export function isEmptyPlan(plan: RootPlan): boolean {
  return Object.values(plan).every((list) => (list as readonly unknown[]).length === 0);
}
