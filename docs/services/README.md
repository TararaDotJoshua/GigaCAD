# Services

The backend is one service: the REST API in `apps/api`, a Fastify app on Railway at `api.gigacad.site`. It also runs the background jobs and renders thumbnails. There's no separate worker. Where it's hosted and how it deploys is in [operations/](../operations/README.md).

## Layout (`apps/api/src`)

| File | Job |
|---|---|
| `server.ts` | Starts the app, the job loop, and the thumbnail loop |
| `app.ts` | Builds the Fastify app: CORS for `WEB_ORIGIN`, error handling, `/health`, and the routes |
| `config.ts` | Environment variables, validated with zod. `.env.example` lists them |
| `db.ts` | postgres.js connection to Supabase Postgres (through the session pooler in production) |
| `auth.ts` | Turns a `Bearer` token into a caller ([auth/](../auth/README.md)) |
| `storage.ts` | S3 client for R2 (SeaweedFS locally): presigned URLs, object keys, and copies |
| `payments.ts` | The Stripe wrapper ([payments/](../payments/README.md)) |
| `mail.ts` | Resend client for stale-checkout emails. Without `RESEND_API_KEY` the emails are skipped |
| `jobs.ts` | Background jobs |
| `errors.ts`, `http.ts` | `HttpError` with a stable `code`, and request helpers |
| `routes/` | HTTP routes, thin: parse, call a service, reply |
| `services/` | The logic, one file per area |
| `thumbnails/` | Thumbnail rendering in a worker thread |

## Routes

Every route is under `/v1`. Errors come back as `{ code, message, details }`, and clients rely on the `code`.

| File | Covers |
|---|---|
| `routes/auth.ts` | Device sign-in (`/auth/device/code`, `/approve`, `/pending/:userCode`, `/token`), personal tokens, `/me` (profile, avatar, deleted projects) |
| `routes/projects.ts` | Projects, members, approval rules, restore, events |
| `routes/blobs.ts` | Upload plans, upload completion, download links, references, exports, thumbnails |
| `routes/branches.ts` | Branches, checkout, checkin, force-release, archive, commits |
| `routes/releaseRequests.ts` | Release requests, picks, candidate, rebuild report, approvals, release, close; releases |
| `routes/directory.ts` | The file directory, search, root files, tags, favorites |
| `routes/sharing.ts` | Explore, profiles, stars, forks |
| `routes/billing.ts` | Checkout, portal, and the Stripe webhook |

## Services (`services/`)

`access.ts` (project roles and read access), `projects.ts`, `blobs.ts`, `manifests.ts`, `branches.ts`, `releaseRequests.ts`, `releases.ts`, `directory.ts`, `exports.ts`, `thumbnails.ts`, `sharing.ts`, `profiles.ts`, `device.ts`, `billing.ts`, and `events.ts`.

`events.ts` records a `project_events` row for every change (checkouts, commits, picks, approvals, releases, directory edits, and so on). That one table is the audit log, the change feed for the desktop app, and the Realtime stream the web app listens to.

## Background jobs (`jobs.ts`)

Run every `JOBS_INTERVAL_MINUTES` (default 60; 0 turns them off):

- `purgeDeletedProjects`: removes projects 30 days after they were deleted.
- `unlinkUnusedBlobs`, then `deleteOrphanBlobs`: drop blobs no manifest, root revision, or export uses, then delete them from R2.
- `clearAbandonedUploads`: removes upload staging objects that never completed.
- `notifyStaleCheckouts`: emails people who have held a checkout for a long time.

## Thumbnails (`thumbnails/`)

Triggers in the database queue a thumbnail for each new file. Every `THUMBNAILS_INTERVAL_SECONDS` the API picks up pending ones and renders them in a worker thread (`worker.ts`), so a heavy STEP file can't stall requests. `parse.ts` reads STL, OBJ, 3MF, STEP, and IGES (STEP and IGES through `occt-import-js`), `render.ts` draws the mesh, and `png.ts` encodes it. SolidWorks files use the preview picture saved inside them (`solidworks.ts`), or their STL export when they have one. Images go to R2 at `thumbnails/<sha>.png`.

## Tests

- Unit tests next to the code (`*.test.ts`), run by `pnpm test`.
- Integration tests in `apps/api/test/*.int.test.ts` run against a real local Supabase and SeaweedFS with `pnpm test:integration`. `workflow.int.test.ts` covers the core flow; the others cover billing, directory, exports, jobs, profiles, restore, sharing, storage, and thumbnails.
