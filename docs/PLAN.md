# GigaCAD (gigacad.site): a GitHub-style PDM for hobbyist CAD

## Context
Hobbyists and enthusiasts don't have an affordable, CAD-agnostic way to version designs. SolidWorks PDM is expensive and tied to one CAD package. Git handles binary CAD files poorly. GigaCAD is a hosted service at **gigacad.site** with a GitHub-like model:

- **Projects** work like repos and can be public or private.
- **Main** is a sequence of **permanently locked Releases** (v1, v2, …).
- All work happens in **branches**, which are **checked out** by one person at a time. A branch holds temporary autosaves and named versions.
- A branch reaches main through a **Release Request**. The requester **picks, file by file,** what replaces main. The system builds a **Release Candidate**, the assembly is **rebuilt in SolidWorks** against the chosen parts, and **configured approvers** sign off.
- Files appear in **Explorer (later Finder) as a virtual drive**, like SolidWorks PDM.

v1 targets **SolidWorks**. SolidWorks is Windows-only, so the Windows drive and a SolidWorks add-in come before the macOS drive. The core stays CAD-agnostic: unknown file types are fully versioned, they just miss the SolidWorks extras.

The directory `/Users/joshtarara/Documents/GigaCAD` is empty, so this is a new build.

## Terminology
| Term | Meaning |
|---|---|
| Project | A repo |
| Release (vN) | An immutable version of main |
| Branch | A working version forked from a release |
| Check out / Check in | Take or give up the exclusive write lock on a branch |
| Version | A named commit on a branch (permanent) |
| Autosave | A snapshot of every file save (temporary) |
| Release Request (RR) | A proposal to release a branch to main |
| Release Candidate (RC) | The picked and rebuilt file set being approved |
| Item | A stable logical-file identity that persists across releases and renames |

## Workflow rules
1. **Main is permanently locked.**
   - Releases can never be edited or deleted, even by the owner. There is no API route to mutate them.
   - Deleting the whole project is the only removal path. It is a soft delete with a 30-day grace period.
2. **Check-out:**
   - Only the user and machine holding a branch's checkout can write to it. Everyone else sees the branch read-only, both in the drive (read-only placeholders) and in SolidWorks (files open read-only, with a banner saying "checked out by @alex").
   - Check-in releases the lock. Owners and maintainers can **force-release** a stale lock; the action is logged and the holder is notified.
   - Checking out also hydrates (downloads) the whole branch so SolidWorks can resolve every reference offline.
3. **Autosaves:**
   - Every save on a checked-out branch creates an autosave.
   - When the next **Version** is committed on that branch, or the branch is **released**, all autosaves since the previous version are deleted.
   - Blobs referenced by nothing else are then garbage-collected.
4. **Release Requests:**
   - Opening an RR freezes the branch, which is checked in automatically and stays read-only while the RR is open. Closing the RR unfreezes it.
5. **Diff pick:** the RR screen lists every file that differs between the branch and the **latest** main. Each file can be set to:
   - **Take branch**, the default for files the branch changed.
   - **Keep main**, the default for files only main changed since the branch was created.
   - **Replace main item X with branch file Y**, for when the branch made a new part (for example via Save As) that should take over an existing part's identity.
   - Deleted files can be **Remove** or **Keep**.

   Warnings appear for files changed on both sides, and for assemblies whose referenced parts are missing or were picked from the other side.
6. **Part identity override:** when a branch file replaces a main file, it **inherits the main file's Item ID**. That part's history continues unbroken, and assemblies in the candidate point to the new file.
7. **Release Candidate and rebuild:**
   - Running "Generate candidate" builds the RC manifest from the picks. It appears in the drive at `candidates/RR-<n>/`, checked out to the requester.
   - "Rebuild candidate" in the SolidWorks add-in:
     1. Opens each top-level assembly.
     2. Repoints references for replaced items (`ISldWorks.ReplaceReferencedDocument` before opening, and Replace Components for internal-ID mismatches).
     3. Runs `ForceRebuild3`.
     4. Collects rebuild errors and mate errors.
     5. Saves and uploads the result.
   - A **rebuild report** (pass, or a list of warnings/errors) is attached to the RR.
   - SolidWorks' own internal document IDs can't be rewritten directly. The rebuild step updates the assembly's references instead, so SolidWorks accepts the new part.
8. **Approvals:**
   - Configured per project: an approver list (users and/or roles), a required count N, whether the requester may approve their own RR (on for solo projects), and whether a clean rebuild report is required.
   - Any change to the candidate resets its approvals.
   - Once all rules are satisfied, **Release** writes vN atomically, locks it, marks the branch released, and prunes its autosaves.

## Architecture

```
gigacad/                         (pnpm monorepo, domain: gigacad.site)
  packages/core/        types, manifest diff, pick → candidate builder, approval evaluation, ignore rules
  packages/parsers/     (folded into apps/api/src/thumbnails) neutral-format parsing (STL/3MF/OBJ/STEP/IGES) and SolidWorks preview pictures
  apps/api/             Fastify on Fly.io/Railway; Supabase Postgres via postgres.js (schema lives in supabase/migrations); Supabase Auth JWT verification; Cloudflare R2 presigned URLs (SeaweedFS locally)
  apps/worker/          pg-boss jobs: glTF/thumbnail generation, blob GC, stale-lock notices
  apps/web/             One Next.js app on Cloudflare Workers (@opennextjs/cloudflare): marketing pages (static) at gigacad.site, product at app.gigacad.site; three.js viewer; Supabase Auth UI
  clients/cli/          `giga` TS CLI (power users + E2E tests)
  clients/windows/      .NET 8: GigaCAD Sync service (Cloud Files API sync root) + tray app + Explorer context menu
  clients/solidworks/   .NET Framework 4.8 COM add-in (SolidWorks API) with Task Pane; talks to Sync service over a named pipe
  clients/macos/        (later) File Provider extension, same folder layout
  supabase/             Supabase CLI project: migrations, RLS policies, local stack (`supabase start`)
  docker-compose.yml    SeaweedFS (R2 stand-in for local dev)
```

### Hosting
| Piece | Service |
|---|---|
| Domain registrar | Namecheap (gigacad.site stays registered there) |
| DNS, CDN | Cloudflare free plan: Namecheap nameservers point to Cloudflare (required for Workers and R2 custom domains) |
| CAD files, previews | Cloudflare R2 (zero egress). Clients upload and download directly through presigned URLs |
| Database, logins, live updates | Supabase (Free while developing, Pro at launch). Supabase Storage is not used |
| Website + marketing | Cloudflare Workers via OpenNext (Workers Paid, $5/mo): `gigacad.site` (marketing), `app.gigacad.site` (product). Reads previews straight from R2 through a Worker binding |
| API + worker | Fly.io or Railway (long-running Node processes; the worker needs RAM for STEP tessellation) |

### Data model (Postgres)
- `profiles` (1:1 with Supabase `auth.users`: handle, quota_bytes), `projects` (visibility, license, `deleted_at`), `project_members` (role: owner/maintainer/contributor/viewer)
- `items`: id, project_id, created_at. This is the stable part identity.
- `blobs`: sha256 PK, size, storage_key. Content-addressed and deduplicated.
- `manifests` plus `manifest_entries` (manifest_id, item_id, path, blob_sha256)
- `releases`: project_id, number, manifest_id, release_request_id, created_by, notes. Insert-only, enforced by a DB trigger that rejects UPDATE/DELETE.
- `branches`: project_id, name, base_release_id, head_commit_id, status (open/frozen/released/archived), `checked_out_by`, `checked_out_machine`, `checked_out_at`
- `commits`: branch_id, parent_id, manifest_id, kind (autosave/version), message, version_label, author
- `release_requests`: branch_id, target_release_id (the latest main at generation time), status (draft/candidate/approved/released/closed), `candidate_manifest_id`, `rebuild_report` (jsonb)
- `rr_picks`: rr_id, path, action (take_branch/keep_main/replace/remove/keep), `replaces_item_id`
- `approval_rules`: project_id, required_count, allow_self_approval, require_clean_rebuild. `approval_rule_approvers`: user_id or role.
- `approvals`: rr_id, user_id, candidate_manifest_id (the approval is only valid for that manifest)
- `file_refs`: blob_sha256, referenced_path, ref_type. For SolidWorks these are supplied by the add-in via `GetDependencies2`.
- `thumbnails`: blob_sha256, format, status (pending/ready/failed/skipped), and an optional `model_sha256` when the thumbnail is drawn from an export. Images live at `thumbnails/<sha>.png` in R2.
- `file_exports`: project_id, source_sha256 (a SolidWorks part or assembly), format (stl/step), blob_sha256. Exports are ordinary uploaded blobs in the project, so they count toward storage, fork with their source, and are cleaned up when their source is.
- `audit_log`: checkouts, force-releases, approvals, releases

### API highlights
- Blobs: `POST /blobs/check` returns the hashes the server is missing; uploads and downloads use presigned multipart URLs.
- `POST /branches/:id/checkout` and `/checkin`: atomic, returning 409 if the branch is held by someone else. `/force-release` is for maintainers and above.
- `POST /branches/:id/commits`: requires the caller to hold the checkout, and the parent must equal the current head. Version commits trigger autosave pruning in the same transaction.
- RR flow: `POST /rr` (freezes the branch) → `GET /rr/:id/diff` → `PUT /rr/:id/picks` → `POST /rr/:id/candidate` → `POST /rr/:id/rebuild-report` → `POST /rr/:id/approve` → `POST /rr/:id/release`
- `GET/PUT /projects/:id/approval-rules`
- Change feed `GET /projects/:id/changes?since=` for the drive clients (catch-up after offline)
- `PUT /projects/:id/exports` attaches an uploaded STEP or STL to a SolidWorks file (contributors and up). `POST /projects/:id/exports/lookup` lists a file's exports; `POST /projects/:id/thumbnails` returns thumbnail links.
- Live updates: Supabase Realtime (Postgres changes on `branches`, `release_requests`, `approvals`) push checkout locks, RR status, and approvals to the web app, tray app, and add-in

### Windows drive (`clients/windows`)
- Registers a Cloud Files sync root (CsWin32/Vanara bindings) called **GigaCAD** in the Explorer sidebar.
- **Layout:** `GigaCAD\<owner>\<project>\`
  - `main\` and `releases\vN\`: read-only
  - `branches\<name>\`: writable only if you hold the checkout
  - `candidates\RR-<n>\`
- Every branch or candidate folder holds the full project tree, so SolidWorks' relative reference resolution works inside it.
- **Save pipeline:**
  - Ignores `~$*.SLDxxx`, `*.bak`, and SolidWorks temp or rename-save artifacts.
  - Waits for a 5 s debounce after the file handle closes.
  - Hashes the file, uploads missing blobs, and posts an autosave.
- **Explorer context menu** (`IExplorerCommand`, with a sparse package for the Windows 11 menu):
  - Check Out / Check In
  - Commit Version…
  - New Branch…
  - Open Release Request
  - History
  - Open on gigacad.site
- Placeholder states show synced, uploading, read-only, and checked-out-by-other.
- The tray app handles sign-in (device code), sync status, and the commit dialog.

### SolidWorks add-in (`clients/solidworks`)
- **Task Pane:**
  - the current project, branch, and checkout holder
  - Check Out / In, Commit Version, Open RR
  - the RC rebuild button
- **On open:** if the file is on a branch you don't hold, it opens read-only with a banner.
- **On version commit:**
  - Sends references from `GetDependencies2` for every assembly and drawing.
  - Exports a coarse STL of each changed part and assembly (`SaveAs3`, the document active and the selection cleared), uploads it next to the file, and attaches it with `PUT /projects/:id/exports`. The server can't read SolidWorks geometry, so this STL is what the web viewer shows and what thumbnails are drawn from.
  - Autosaves don't export: exporting blocks SolidWorks while it runs.
- **On release candidate rebuild** (workflow rule 7): the add-in already has every file of the candidate open, so it also exports a STEP (AP242) and a fine STL of each part and assembly and attaches them. Every release can then be downloaded as STEP or STL from the web.
- Exports are optional. Files committed without the add-in (the CLI, macOS) show the preview picture SolidWorks saved inside them, and `giga export <file> <export>` attaches a STEP or STL by hand.

### Web (gigacad.site)
- **Project page:** release selector, file tree with thumbnails, 3D viewer, README. SolidWorks files preview from their STL export and offer STEP and STL downloads when they have them.
- **Branches page:** checkout badges ("checked out by @alex, 2h") and each branch's version timeline. Autosaves appear as a collapsible "unsaved work" group.
- **Release Request:**
  - diff-pick table with before/after 3D previews, per-file pick controls, and a replace-item picker
  - warnings, the rebuild report, the approver panel showing required vs received, and the Release button
- **Settings:** members, approval rules, visibility, license.
- **Explore page:** public projects, fork a release, user profiles.

## Implementation phases
0. **Foundation:**
   - Monorepo, Vitest, docker-compose.
   - `packages/core`: manifest diff, candidate builder from picks (with item-ID inheritance), approval evaluator, autosave-pruning selector, ignore rules.
1. **API:**
   - Schema and migrations (including the releases immutability trigger), Supabase Auth (email + GitHub/Google OAuth) plus a device-code endpoint for the desktop client and add-in (user approves at app.gigacad.site/device; the API issues a Supabase session), blobs, checkout locks, commits and pruning, the RR/candidate/approval flow, change feed.
   - `giga` CLI covering all of it.
2. **Web UI and marketing site:** every page above plus landing, pricing, and docs pages. Deploy per the Hosting section.
3. **Windows Sync client:** sync root, hydration, save pipeline, read-only enforcement, context menu, tray app.
4. **SolidWorks add-in:** Task Pane, read-only banner, references, STL export on version commits, STEP and STL export on candidate rebuilds, candidate rebuild.
5. **Worker (done in the API):** thumbnails (rendered from STL/OBJ/3MF/STEP/IGES and from SolidWorks exports, or the preview picture saved in SolidWorks files), blob GC, stale-lock notifications. The server stores and serves exports (`file_exports`) for downloads and previews.
6. **Public sharing:** explore, fork, stars.
7. **macOS File Provider client**, plus other CAD packages (Fusion, FreeCAD, Onshape exports) through generic parsers.

## Verification
- **Unit (`pnpm test`):**
  - Candidate builder: take/keep/replace/remove picks, item-ID inheritance on replace, files changed on both sides.
  - Approval evaluator: N of M approvers, self-approval flag, approvals invalidated when the candidate manifest changes, clean-rebuild requirement.
  - Autosave pruning selector.
  - Ignore rules for SolidWorks temp files.
- **API integration** (local Supabase via `supabase start` + SeaweedFS):
  - A second user's checkout gets 409, and commits without the checkout are rejected.
  - A force-release is recorded in the audit log.
  - Committing a version deletes earlier autosaves and GC removes the orphaned blobs.
  - UPDATE/DELETE on `releases` fails at the DB level.
  - Releasing without the required approvals returns 403.
- **CLI end-to-end:**
  1. Release a v1 containing an assembly and its parts.
  2. Branch A edits part P1 and is released as v2.
  3. Branch B edits P1 and P2 and adds P3 intended to replace P4.
  4. In B's RR, keep main's P1, take P2, and replace P4 with P3.
  5. Assert that v3 has A's P1, B's P2, and P3 at P4's item ID.
- **Web:** Playwright covering diff pick → candidate → approvals → release.
- **Windows and SolidWorks (manual, on the Windows laptop with SolidWorks):**
  1. Check out a branch and open a sample assembly from `GigaCAD\...\branches\dev\`.
  2. Save a part and confirm the autosave appears.
  3. From a second account, confirm the branch opens read-only.
  4. Commit a version and confirm the autosaves are gone.
  5. Open an RR with a replace pick and run Rebuild candidate in SolidWorks. Confirm the assembly loads the new part and the rebuild report reads clean.
  6. Approve and release, then confirm `main\` is read-only and shows vN.
  7. Confirm each committed part and assembly has an STL export: its thumbnail is drawn from it and the web viewer opens it. Confirm the released vN offers STEP and STL downloads, and that the STEP opens in another CAD program.
