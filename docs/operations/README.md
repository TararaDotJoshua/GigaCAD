# Operations

Hosting, CI, deploys, and local development. [deployment.md](deployment.md) records every production setup step, with a status table of dates and IDs.

## Production

| Piece | Where |
|---|---|
| Domain | `gigacad.site`, registered at Namecheap. DNS and CDN on Cloudflare, and `www` 301s to the apex |
| Web (marketing and product) | Cloudflare Workers (Workers Paid) through OpenNext: `gigacad.site`, `app.gigacad.site`. Config in `apps/web/wrangler.jsonc` |
| API | Railway, service `@gigacad/api`, US East: `api.gigacad.site`, health at `/health`. Built from `Dockerfile.api` |
| Database, Auth, Realtime | Supabase `GigaCAD Production`, ref `gaxicutwgacxekqcsnpg`, us-east-1, on the Free plan (Pro is owed before launch). The API connects through the Supavisor session pooler |
| CAD files | R2 bucket `gigacad-prod`, with CORS for `app.gigacad.site` |
| Desktop downloads | R2 bucket `gigacad-downloads` at `downloads.gigacad.site`. Nothing is published yet |
| Email | Resend, domain `send.gigacad.site`, used by Supabase Auth's SMTP and the API |
| Payments | Stripe ([payments/](../payments/README.md)) |
| CLI | npm `@gigacad/cli`, org `gigacad` |

Fixed cost is about $10 a month (Workers and Railway). Supabase Pro adds $25 at launch. R2 is free up to 10 GB.

## CI (`.github/workflows/`)

| Workflow | Does |
|---|---|
| `ci.yml` | On every PR and push to `main`: `check` (typecheck, unit tests, build, CLI pack smoke), `api-image` (builds `Dockerfile.api`), `integration` (SeaweedFS and local Supabase, then `pnpm test:integration`), `e2e` (Playwright against a local stack), `windows` (.NET tests, plugin tests over real named pipes, Windows lock and menu tests, NSIS installer), and `desktop` (macOS, optional) |
| `deploy-web.yml` | After CI passes on `main`: builds and deploys the web app to Workers, then runs `check-site.sh` |
| `desktop-release.yml` | Run by hand: publishes signed update bundles, and with `dmg` the macOS DMG. #50 adds the Windows installer |
| `uptime.yml` | Every 15 minutes: `scripts/check-site.sh`. GitHub emails failures |

## Merge rules

- Every change to `main` goes through a PR. `main` requires `check`, `api-image`, `integration`, and `e2e`, and must be up to date. Auto-merge is on. `windows` should become required.
- Railway deploys the API after CI passes on `main` ("Wait for CI"). Configure Railway in its dashboard, not with a `railway.json`.
- **Migrations are manual.** Run `supabase db push` against production before merging the PR that adds one. The supabase CLI is linked to production, so always pass `--local` to local migration commands. `supabase db query --linked "<sql>"` runs read-only checks on production.
- Check deploys by the HTTP status of each kind of page, never by matching page text. Never hard-code a handle in checks.
- Run web scripts with `pnpm --filter @gigacad/web run <script>`. Bare `pnpm deploy` is pnpm's own command.
- Ask the owner before anything outward-facing or hard to undo: publishing to npm, release workflows, production migrations, Stripe changes, or deleting accounts or projects.

## Local development

```sh
corepack enable && pnpm install
pnpm typecheck && pnpm test && pnpm build
pnpm --filter @gigacad/web dev                 # site on :3000

# Full local stack (Docker Desktop: open -a Docker)
docker compose up -d s3 && docker compose run --rm s3-setup   # SeaweedFS on :9000
supabase start                                  # local DB and Auth; Mailpit on :54324
cp apps/api/.env.example apps/api/.env          # first time
(cd apps/api && node --env-file=.env dist/server.js)          # API on :8787
(cd apps/web && pnpm start)                     # needs apps/web/.env.local from .env.example
pnpm test:integration
pnpm --filter @gigacad/web e2e

pnpm test:windows                               # .NET protocol tests (.NET 10 SDK)
pnpm --filter @gigacad/desktop dev              # desktop app
```

- Confirmation and reset emails land in Mailpit at `http://127.0.0.1:54324`.
- If Docker pulls fail with `docker-credential-desktop: executable file not found`, add `/Applications/Docker.app/Contents/Resources/bin` to your PATH.
- To test web changes against production without deploying, run `next dev` with the production `NEXT_PUBLIC_*` values (`gh variable list`) and a `tararajoshua+<tag>@gmail.com` test account.
- Ignored secret files, never printed or committed: `apps/api/.env`, `.env.r2`, `.env.stripe`, `apps/web/.env.local`, and `supabase/.env.oauth`. The Supabase database password and Management API token are in the macOS Keychain.

## The development Mac

- Intel x86_64 with no Homebrew. Xcode barely runs, and there's no Apple Developer account.
- `gh` is in `~/.local/bin`. Non-interactive shells need `export PATH="$HOME/.local/bin:$PATH"`.
- DNS drops sometimes, so retry network failures.
- The main checkout often has another session's uncommitted work. Do new work in a separate git worktree off `main`.

## Accounts

| Service | Used for | Status |
|---|---|---|
| Namecheap | Registrar | Active |
| Cloudflare | DNS, Workers ($5/month), R2 | Active. The R2 spending alert is still owed |
| Supabase | Postgres, Auth, Realtime | Active on Free. Pro is owed before launch |
| Railway | API (Hobby) | Active |
| Resend | Auth and notice emails | Active. DKIM, SPF, and DMARC (`p=none`) are set |
| Stripe | Payments | Live |
| npm | `@gigacad/cli` | 0.1.0 published |
| GitHub | Repo, CI/CD, secrets, uptime emails | Active |
| GitHub and Google OAuth apps | Social sign-in | Not created yet |
| Azure Trusted Signing | Windows code signing | Planned |
| Apple Developer Program | macOS notarization and File Provider | Not planned for now |
