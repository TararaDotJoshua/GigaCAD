# GigaCAD documentation

GigaCAD is a hosted, GitHub-style version-control service (PDM) for hobbyist CAD files, SolidWorks first. It lives at **gigacad.site**. This page explains the whole codebase. Each folder below goes deeper into one part of it and holds the plans for that part.

| Folder | Covers | Plans inside |
|---|---|---|
| [product/](product/README.md) | What GigaCAD is, its words, and its workflow rules | [plan.md](product/plan.md) (the full product design), [roadmap.md](product/roadmap.md) (live to-do list) |
| [design/](design/README.md) | The design system: colors, type, layout, components, voice | The design system itself is binding |
| [ui/](ui/README.md) | The web app (marketing and product) and the desktop app's window | [file-directory-plan.md](ui/file-directory-plan.md), [web-ux-plan.md](ui/web-ux-plan.md), [desktop-ux-plan.md](ui/desktop-ux-plan.md) |
| [services/](services/README.md) | The API: routes, services, background jobs, thumbnails, storage, email, live updates | |
| [data/](data/README.md) | The database, file storage, manifests and items, immutability, quotas | |
| [auth/](auth/README.md) | Sign-in, sessions, device tokens, roles, and row-level security | |
| [payments/](payments/README.md) | Plans, storage limits, and Stripe | |
| [clients/](clients/README.md) | The `giga` CLI, the desktop app (macOS and Windows), and the SolidWorks add-in | [windows-app-plan.md](clients/windows-app-plan.md), [windows-pc-runbook.md](clients/windows-pc-runbook.md) |
| [operations/](operations/README.md) | Hosting, CI, deploys, migrations, local development, and accounts | [deployment.md](operations/deployment.md) (every production setup step) |

## The product in one paragraph

A **project** is a repo. Its main line is a sequence of **releases** (v1, v2, …) that can never be changed. Work happens on **branches**, which one person at a time **checks out**. Every save is an **autosave**; a named **version** is permanent and clears the autosaves before it. A **release request** freezes a branch, lets the requester **pick file by file** what replaces main (including a branch part that takes over a main part's identity), builds a **release candidate**, and collects the project's configured **approvals** before releasing. The project root also holds ordinary **root files** with their own revisions. See [product/](product/README.md).

## How the pieces fit

```
                 gigacad.site / app.gigacad.site
   Browser ──▶  apps/web (Next.js on Cloudflare Workers)
                    │  server components call the API with the user's Supabase token
                    │  the browser listens to Supabase Realtime for live updates
                    ▼
   giga CLI ──▶  apps/api (Fastify on Railway, api.gigacad.site) ──▶ Supabase Postgres (data, RLS)
   Desktop  ──▶       │  checks Supabase JWTs or gcd_ device tokens
     app              │  hands out presigned URLs
     ▲                ▼
     │          Cloudflare R2 (CAD files, thumbnails, avatars)  ◀── clients upload and download directly
     │
   SolidWorks add-in (planned) talks to the desktop app over a named pipe
```

- **The API is the only writer.** The web app, CLI, and desktop app all write through `apps/api`. Postgres row-level security only grants reads, which Realtime and the API's access checks rely on.
- **File bytes never pass through the API.** Clients hash files (SHA-256), ask which hashes the server lacks, and upload straight to R2 through presigned URLs. Blobs are content-addressed, so each file is stored once, and a project can only read blobs uploaded into it.
- **Rules live in one place.** `packages/core` holds the logic every app shares: file-list diffs, the candidate builder, approvals, autosave pruning, ignore rules, path rules, plans, and handles.

## Repository map

A pnpm monorepo: Node 22+, pnpm 10 through corepack, TypeScript, and Vitest. The GitHub repo `TararaDotJoshua/GigaCAD` is **public**, so never commit secrets.

| Path | What | More |
|---|---|---|
| `packages/core` | Shared rules: manifest diff, candidate builder (picks and item-ID inheritance), approval evaluator, autosave pruning, ignore rules, path validation, plans, handles, contributions | [product/](product/README.md) |
| `apps/api` | Fastify REST API (`/v1/...`), background jobs, and thumbnail rendering | [services/](services/README.md) |
| `apps/web` | One Next.js app: marketing at `gigacad.site`, the product at `app.gigacad.site`, sign-in, and Playwright tests | [ui/](ui/README.md) |
| `supabase` | Migrations (schema, triggers, RLS), auth email templates, and local stack config | [data/](data/README.md) |
| `clients/cli` | `giga`, the command line (npm `@gigacad/cli`) | [clients/](clients/README.md), `clients/cli/README.md` |
| `clients/desktop` | Electron app for macOS and Windows. Projects become real folders, and it hosts the CAD plugins | [clients/](clients/README.md), `clients/desktop/README.md` |
| `clients/windows` | .NET: the pipe protocol library the SolidWorks add-in will use | [clients/](clients/README.md), `clients/windows/README.md` |
| `scripts/` | `check-site.sh` (live page statuses), `check-secrets.sh` (fails CI on keys), `enable-oauth.sh` | [operations/](operations/README.md) |
| `.github/workflows/` | `ci.yml`, `deploy-web.yml`, `desktop-release.yml`, `uptime.yml` | [operations/](operations/README.md) |
| `docker-compose.yml` | SeaweedFS, the local S3 stand-in for R2 | [operations/](operations/README.md) |
| `Dockerfile.api` | The API image Railway deploys | [operations/](operations/README.md) |

## Getting started

```sh
corepack enable && pnpm install
pnpm typecheck && pnpm test && pnpm build
pnpm --filter @gigacad/web dev      # site on localhost:3000
```

The full local stack (Supabase, SeaweedFS, API, web) is in [operations/](operations/README.md#local-development).

## Keeping these docs current

- [product/roadmap.md](product/roadmap.md) is the live to-do list. Update it as items finish.
- Mark finished production steps in the [deployment guide](operations/deployment.md)'s status table with dates and IDs, never secrets.
- When you start a new plan, put it in the folder for its subject and link it from that folder's README and from the table above.
