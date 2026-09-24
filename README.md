# GigaCAD

GitHub-style version control for CAD files (SolidWorks first), hosted at gigacad.site. See [docs/PLAN.md](docs/PLAN.md) for the design.

## Layout

| Path | What |
|---|---|
| `packages/core` | Shared rules: manifest diffs, release candidates (diff pick + part replacement), approvals, autosave pruning, ignore rules |
| `apps/api` | REST API (Fastify): projects, branches with check-out locks, commits and autosaves, release requests with diff pick, approvals, releases, file uploads to R2, desktop sign-in |
| `supabase` | Database schema and row-level security (migrations), run locally with `supabase start` |
| `apps/web` | Next.js site: the marketing page at gigacad.site (product pages come later). Follows [docs/DESIGN.md](docs/DESIGN.md) |

## Development

Requires Node 22+. pnpm comes from corepack:

```sh
corepack enable        # once, puts pnpm on your PATH
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @gigacad/web dev   # marketing site on localhost:3000
```

### API

The API needs the local Supabase stack and MinIO (the local stand-in for Cloudflare R2), both in Docker:

```sh
supabase start                      # database, logins, live updates; applies supabase/migrations
docker compose up -d                # MinIO on :9000 with a `gigacad` bucket
cp apps/api/.env.example apps/api/.env
pnpm --filter @gigacad/api dev      # API on localhost:8787
pnpm test:integration               # API tests against the real local stack
```

If Docker image pulls fail with `docker-credential-desktop: executable file not found`, add
`/Applications/Docker.app/Contents/Resources/bin` to your PATH.
