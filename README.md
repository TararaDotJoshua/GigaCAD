# GigaCAD

GitHub-style version control for CAD files (SolidWorks first), hosted at gigacad.site. See [docs/PLAN.md](docs/PLAN.md) for the design.

## Layout

| Path | What |
|---|---|
| `packages/core` | Shared rules: manifest diffs, release candidates (diff pick + part replacement), approvals, autosave pruning, ignore rules |
| `apps/api` | REST API (Fastify): projects, branches with check-out locks, commits and autosaves, release requests with diff pick, approvals, releases, file uploads to R2, desktop sign-in |
| `supabase` | Database schema and row-level security (migrations), run locally with `supabase start` |
| `apps/web` | Next.js site: the marketing page at gigacad.site (product pages come later). Follows [docs/DESIGN.md](docs/DESIGN.md) |
| `clients/cli` | `giga`, the command line (npm package `@gigacad/cli`): sign-in, clone, check-out locks, commits, release requests, releases. See [its README](clients/cli/README.md) |

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

The API needs the local Supabase stack and SeaweedFS (the local stand-in for Cloudflare R2), both in Docker:

```sh
supabase start                      # database, logins, live updates; applies supabase/migrations
docker compose up -d                # SeaweedFS S3 on :9000 with a `gigacad` bucket
cp apps/api/.env.example apps/api/.env
pnpm --filter @gigacad/api dev      # API on localhost:8787
pnpm test:integration               # API tests against the real local stack
```

### CLI

With the API running (and the web app, to approve sign-ins):

```sh
pnpm --filter @gigacad/cli build
GIGA_API_URL=http://127.0.0.1:8787 node clients/cli/dist/giga.js login
pnpm --filter @gigacad/cli smoke    # pack the npm package, install it, and run it
```

`pnpm test:integration` also runs the CLI against the local API and SeaweedFS, including the v1→v2→v3 release scenario.

### Web sign-in

Copy `apps/web/.env.example` to `apps/web/.env.local`. Set its Supabase URL and
publishable key from `supabase status -o json`; the other example URLs are for
local development. Start the API and web app together. The marketing site's Log
in and Start a project links then open the local account pages. Confirmation and
reset emails appear in local Mailpit at `http://127.0.0.1:54324`.

The browser flow has email/password sign-in, confirmation, password recovery,
GitHub/Google buttons when enabled, and a `/device` page for the CLI and future
Windows client. A new account chooses its public handle on `/app`. Supabase Auth
and the API use the same Supabase project; the API must point `WEB_ORIGIN` at the
web app's origin.

Before enabling public registration in the hosted project:

1. Set the Supabase Auth Site URL to `https://app.gigacad.site`. Allow redirects
   to `https://app.gigacad.site/auth/callback**`, `/app`, `/device**`, and
   `/reset-password` on that origin. Enable email confirmation.
2. Configure custom SMTP for account confirmation and password recovery. Copy
   `supabase/templates/confirmation.html` and `recovery.html` into the hosted
   project's corresponding Auth email templates. Local templates are configured
   in `supabase/config.toml`; they are not automatically applied to hosted Auth.
3. Create GitHub and Google OAuth applications with the callback URL shown in
   each provider's Supabase Auth settings. Store provider client secrets only
   in Supabase. Once each provider works, set its corresponding
   `NEXT_PUBLIC_*_AUTH_ENABLED` flag to `true` in the web deployment.
4. Set the web deployment's public Supabase URL and publishable key, API URL,
   and `NEXT_PUBLIC_GIGACAD_APP_URL=https://app.gigacad.site`. Set the API's
   `WEB_ORIGIN=https://app.gigacad.site`. Never put a Supabase secret or service
   role key in a `NEXT_PUBLIC_` variable.

The email links first show a confirmation screen; the token is used only after
the recipient selects Continue. OAuth uses `/auth/callback`, while email links
use `/auth/confirm`.

If Docker image pulls fail with `docker-credential-desktop: executable file not found`, add
`/Applications/Docker.app/Contents/Resources/bin` to your PATH.
