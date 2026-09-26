# Project file directory plan

## Goal

Make each GigaCAD project feel like a familiar file directory. People can keep ordinary files at the project root, organize them into folders, add custom tags, and find them quickly. `Branches` and `Releases` appear as folders alongside those root files. The directory is part of the base GigaCAD file experience; this work does not add paid GigaPDM features.

Root files have their own revision history. Replacing a root file records a revision, but does not change a branch head or release. Releases stay read-only. Branch files remain editable through the existing checkout and commit workflow in the CLI or future drive.

## Directory behavior

- The project root contains user-created files and folders, plus the reserved virtual folders `Branches` and `Releases`. User-created root entries cannot use either reserved name, ignoring case.
- `Branches/<branch name>/` shows the files at that branch's current head, using their existing relative paths. The web directory provides browsing, preview, and download; changes continue through checkout and commit. It must not bypass the branch lock.
- `Releases/v<number>/` shows the immutable files in that release, using their existing relative paths. No upload, replace, move, rename, or delete action is available there.
- Root folders support nesting and may be empty. Users can create folders, upload files, replace file contents, rename or move entries, and download files. Moves preserve file identity and revision history. Replacing content creates a root file revision; renames and moves do not create content revisions.
- Paths and names use the existing Windows-compatible, case-insensitive project path rules. A move must fail cleanly if its destination exists, is inside the folder being moved, or would exceed the path limit. Root files are not silently added to branches or releases.

## Implementation

1. **Data and storage.** Add project-scoped directory entries with parent-child relationships, kind (`file` or `folder`), name, and stable identity. Enforce case-insensitive uniqueness among siblings. Add a root file revision table with blob hash, author, and timestamp; the current revision is the latest successful replacement. Reuse the project's R2 blob upload and quota accounting. Add project tags and file-tag assignments, and per-user file favorites. Tags attach to stable file identities and represent current metadata, including when an older snapshot is viewed.
2. **API.** Add authenticated endpoints to list directory contents, create folders, upload or replace root files, move and rename entries, read root revision history, manage project tags and file assignments, toggle favorites, and search. Return root, branch-head, and release matches with a location identifying the folder and snapshot. Use pagination for directory and search results. Apply existing project visibility and membership rules: readers may browse; contributors and above may change root files and tags; only the favorite owner may change a favorite. Preserve the API-only write pattern and add project-scoped RLS read policies for new tables.
3. **Web directory.** Replace the project page's flat file list with a folder view and breadcrumbs. Provide root file actions, tag controls, filename and tag search, sorting, recent files, and a personal favorites view. Reuse existing thumbnail, preview, export, and download components where applicable. Show branch lock state and keep branch/release actions consistent with their existing workflows.
4. **Compatibility and rollout.** Keep current manifests, item IDs, commits, releases, and CLI request shapes intact. Derive branch and release folders from those existing records; do not copy their blobs into root storage. Existing projects start with an empty ordinary root and immediately show their existing branches and releases. Update product documentation to explain root file revisions and the directory layout. Keep paid GigaPDM capabilities outside this release.

## Verification

- Create nested and empty folders; upload, replace, rename, and move root files; confirm that revisions and tags remain attached to the same file.
- Reject case-insensitive collisions, reserved root names, invalid paths, and moving a folder into itself without partial changes.
- Confirm root edits leave branch heads and releases unchanged, branch writes still require checkout, and releases remain immutable.
- Check tag, filename, recent, and favorite views across root files, branch heads, and releases, including duplicate appearances of one logical file.
- Check contributor, viewer, public, private, and signed-out access; verify project isolation and storage quota accounting.
- Run API integration tests, web tests, and CLI pull/commit regressions before release.

## Further ideas

After the first release, consider saved searches or smart collections, bulk tagging and moves, file descriptions and custom fields, and a details panel showing a file's locations and revisions. These are separate follow-up features, not requirements for the directory release.
