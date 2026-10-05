# Data handling

GigaCAD keeps metadata in Supabase Postgres and file bytes in Cloudflare R2. Supabase Storage isn't used.

## Who writes what

- **The API is the only writer.** It connects as the database owner and enforces every rule in `apps/api/src/services`.
- **Row-level security only grants reads.** Members of a project, and everyone for public projects, can read its rows (`can_read_project`). That's what lets Supabase Realtime deliver `project_events` to the browser safely. See [auth/](../auth/README.md).
- **Migrations** in `supabase/migrations/` are the schema. They're applied to production by hand with `supabase db push` before merging the PR that adds one ([operations/](../operations/README.md)).

## Tables

| Area | Tables |
|---|---|
| People | `profiles` (handle, bio, avatar, `quota_bytes`; created by a trigger on sign-up), `device_codes`, `device_tokens` |
| Projects | `projects` (visibility, license, `deleted_at`, `forked_from_release_id`), `project_members` (owner, maintainer, contributor, viewer), `approval_rules` (approver users and roles, required count, self-approval, clean rebuild), `stars` |
| Files | `blobs` (sha256, size), `project_blobs` (which projects may use a blob), `blob_uploads` (staging), `blob_references` (an assembly's parts), `items` (stable file identity), `manifests` and `manifest_entries` (path → item → blob) |
| History | `releases`, `branches` (status, checkout holder and machine), `commits` (autosave or version), `release_requests` (picks as JSON, candidate manifest, rebuild report), `approvals` (tied to one candidate manifest) |
| Directory | `directory_entries` (root files and folders), `root_file_revisions`, `project_tags`, `file_tags`, `file_favorites` |
| Previews | `thumbnails`, `file_exports` (STEP or STL attached to a SolidWorks file) |
| Activity | `project_events`: audit log, change feed, and Realtime stream in one |
| Billing | `billing_accounts` ([payments/](../payments/README.md)) |

## How files are stored

1. A client hashes each file with SHA-256 and asks the API which hashes the project is missing.
2. The API hands out presigned upload URLs to a staging key (`uploads/<id>`). R2 checks the signed SHA-256 checksum, so altered bytes are rejected.
3. On completion the API copies the object to `blobs/<sha[0:2]>/<sha>` and links it to the project in `project_blobs`.
4. Downloads use presigned GET URLs that keep the file's name.

Blobs are content-addressed, so a file is stored once no matter how many versions use it. A project can only read blobs uploaded into it, or copied in by a fork, so knowing a hash isn't enough to read someone else's file.

## Versions are file lists

Every release, commit, and candidate points to a **manifest**: a list of `(path, item, blob)` entries. Diffs, picks, and candidates work on manifests (`packages/core/src/manifest.ts` and `candidate.ts`). An **item** is a file's identity, separate from its path and content, so a rename or a "replace" pick keeps the history attached.

## Guarantees the database enforces

- `releases_locked`: releases can't be updated or deleted.
- `manifest_entries_immutable`: a written manifest never changes.
- A branch can only be checked out while it's open, and the holder and machine are set together.
- Case-insensitive unique names among siblings in the directory, and no `Branches` or `Releases` at the root.

## Storage accounting

`storage_used_bytes(owner)` adds up the distinct blobs in the owner's live projects. Uploads that would go over `profiles.quota_bytes` fail with `storage_full` (`requireStorageFor` in `services/billing.ts`). Everything stays readable when an account is over quota.

## Cleanup

Autosaves are pruned at the next Version or release. Background jobs then drop unused blobs from R2 and purge projects 30 days after deletion ([services/](../services/README.md#background-jobs-jobsts)).
