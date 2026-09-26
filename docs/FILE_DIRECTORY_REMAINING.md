# Project file directory: progress and remaining work

Implementation status for [FILE_DIRECTORY_PLAN.md](FILE_DIRECTORY_PLAN.md), as of 2026-09-26. Nothing is committed yet; everything below is uncommitted work on the `PDM` branch.

## Done

### Data and storage: done and tested

- Migration `supabase/migrations/20260927010000_file_directory.sql`, applied to the local database only:
  - `directory_entries` stores root files and folders. It has a parent, a kind, a name, and a generated `name_key`. Sibling names are unique regardless of case (`nulls not distinct`, so this covers the root too). `Branches` and `Releases` are refused at the root. A file's `item_id` points to `items`, so root files share the identity model that tags and favorites use.
  - `root_file_revisions` stores a numbered revision per upload or replacement. A foreign key requires each revision's blob to be in `project_blobs`, so revisions count toward storage.
  - `project_tags`, `file_tags` (attached to items), and `file_favorites` (per user).
  - A trigger queues thumbnails for root revisions. `branch_file_changed()` returns when and by whom a branch-head file last changed.
  - RLS read policies use `private.can_read_project`. Favorites are visible only to their owner.
- `packages/core/src/paths.ts` has `validateEntryName` (Windows-safe names; reserved device names; reserved root names), `isReservedRootName`, and `MAX_PATH_LENGTH`. Unit tests are in `paths.test.ts`.
- `apps/api/src/jobs.ts`: the unused-blob job keeps blobs that root revisions use, and purge deletes directory entries before the project.
- `apps/api/src/services/exports.ts`: SolidWorks exports can now attach to root files.

### API: done and tested

- `apps/api/src/services/directory.ts` and `apps/api/src/routes/directory.ts` provide:
  - `GET /v1/projects/:id/directory?path=&sort=&order=&offset=&limit=` lists the root, root folders, `Branches[/<name>/...]`, and `Releases[/v<n>/...]`. The response includes breadcrumbs, branch lock state, and `writable`.
  - `GET /v1/projects/:id/files?q=&tags=&favorites=&area=&sort=` searches the root, branch heads, and releases. Each result includes its location. `sort=modified` gives recent files.
  - `GET|POST /directory/folders`, `POST /directory/files`, `GET|PATCH|DELETE /directory/entries/:entryId`, and `POST /directory/entries/:entryId/revisions`.
  - `GET|POST /tags`, `PATCH|DELETE /tags/:tagId`, `PUT /items/:itemId/tags`, and `PUT|DELETE /items/:itemId/favorite`.
- Directory writes lock the project row. Moves reject name collisions, moves into the folder itself, and paths over 1024 characters without making partial changes.
- `apps/api/test/directory.int.test.ts` has 10 tests, all passing against local Supabase. They cover:
  - nested and empty folders, revisions, renames, and moves
  - collisions, reserved names, invalid names, path limits, and moving a folder into itself
  - root edits leaving branches and releases unchanged, and commits still requiring checkout
  - search across all three areas, including duplicate appearances of one file
  - tag and favorite filters, recent files, and paging
  - access for contributors, viewers, strangers, public projects, and signed-out users
  - project isolation, RLS on the new tables, quota accounting, and the unlink job

### Web: done, tested, and checked in a browser

- `lib/api.ts` types, `lib/product.ts` reads (`getDirectory`, `searchFiles`, `getTags`, `getRootFolders`, `getEntry`), and `lib/paths.ts` helpers (`treePath`, `entryPath`).
- `app/(product)/actions.ts`: browser upload steps (`startUpload`, `finishUpload`), `addRootFile`, `replaceRootFile`, `createFolder`, `moveEntry`, `deleteEntry`, tag actions, and `setFavorite`.
- `lib/upload.ts` hashes a file in the browser, PUTs it to the presigned URL, and completes the upload. The browser limit is 2 GB.
- Components: `ProjectDirectory.tsx`, `UploadFiles.tsx`, `FavoriteButton.tsx`, and `TagPicker.tsx`. The tag picker is placed against the viewport (`position: fixed`), so the table's scrolling and rounded corners don't clip it. It opens upward near the bottom of the screen and closes on scroll or resize.
- Pages: the project root (`?release=N` redirects to `tree/Releases/vN`), `tree/[...path]`, `entries/[entryId]`, and the shared `ProjectFilesPage.tsx`.
- `lib/describe.ts` activity sentences and `product.css` directory styles. The search input is now styled; before, it showed a bare native box, on Explore too. Modified times no longer wrap mid-phrase.
- `e2e/release.e2e.ts`: the new directory test passes. It needed `exact: true` on one folder link.

### Right-click menu (2026-09-26)

- `EntryMenu.tsx` replaces the folder rows' settings gear. Right-clicking a root file or folder opens Open (or Revisions and details), Rename…, Move to…, and Delete. A long press does the same on touch screens, and the context-menu key or Shift+F10 on keyboards. Rows opt in with `data-entry-*` attributes, only for contributors and above.
- New server actions `renameEntry`, `moveEntryTo`, and `removeEntry` change the entry in place and refresh the folder. The entry page still has its forms.
- The e2e directory test moves, renames, and deletes through the menu.
- The migration was renamed from `20260926040000` to `20260927010000`, so it runs after the profile page migration that production already has.

### Checked by hand (2026-09-26, with Playwright screenshots)

- Folder names with spaces, `%`, `#`, `+`, and non-ASCII characters open correctly, including nested folders and branch subfolders.
- Browser PUTs to local SeaweedFS work, with no CORS problems.
- LiveRefresh shows new folders and tag changes without a reload.
- At 390 px and 768 px wide, the page doesn't overflow. The table scrolls sideways inside its frame, like other tables.

### Tests (2026-09-26)

- `pnpm typecheck` passes, and `pnpm test` passes (149 tests).
- `pnpm test:integration` passes (70 tests). The first run failed in `jobs.int.test.ts` because 11 stale `blob_uploads` rows from earlier runs remained in the long-lived local database. The test assumes nothing is older than its grace period. It passes on a clean database, as in CI.
- `pnpm --filter @gigacad/web e2e` passes (9 tests). Locally, first start the API with `apps/api/.env` loaded (`node dist/server.js`) and `pnpm start`. Playwright reuses them, but its own webServer start timed out here.

### Documentation

- New docs page, "Project files" (`/docs/project-files`, under Everyday work): the root, Branches and Releases, root file revisions compared with branch versions, tags, favorites, and search. It also adds a "Root file" term to Concepts.
- README layout table and the project page line in `docs/PLAN.md` are updated.
- The over-2 GB upload error no longer suggests the drive or CLI, since neither can add root files.

## Remaining

1. **Decisions for the owner** before merging:
   - Archived branches appear under `Branches` and in search. Should they be hidden by default?
   - Search runs `branch_file_changed()` once per branch-head file, which is fine at current sizes. On large projects, a stored "changed at" per manifest entry would remove the cost.
   - Folder listings load one folder's children, then sort and page in memory. That's fine for normal folders; folders with tens of thousands of entries would need SQL paging.
   - The activity feed deliberately skips tag renames, tag deletions, and file tag changes.
2. **Release**, which needs the owner's go-ahead:
   - Push the migration to production with `supabase db push` before merging, following `docs/NEXT.md`.
   - Commit on `PDM` and open a pull request. All four CI jobs (`check`, `api-image`, `integration`, `e2e`) must pass.
   - After merging, record the directory as shipped in `docs/NEXT.md`.

Paid GigaPDM features remain out of scope, as the plan says.
