# Deploying GigaCAD

This is the plan for taking GigaCAD live. The repo side (the API image, the Workers config, and the CI workflows) is done. Service setup is in progress; see the status table below. Work through the steps in order: each one depends on the ones before it. When a step is done, mark it here with the date and any values other agents need, such as the region or project ref. Never write secrets into this file.

## What runs where

| Piece | Service | Address |
|---|---|---|
| DNS, CDN | Cloudflare (nameservers moved from Namecheap, which stays the registrar) | `gigacad.site` |
| Marketing site and product web app | One Next.js app on Cloudflare Workers through OpenNext | `gigacad.site` (marketing), `app.gigacad.site` (product) |
| API (`apps/api`) | Railway, one long-running Node service | `api.gigacad.site` |
| Database, sign-in, live updates | Supabase (hosted Postgres, Auth, Realtime) | `<ref>.supabase.co` |
| CAD files | Cloudflare R2. Clients upload and download directly through presigned URLs | bucket `gigacad-prod` |
| CLI | npm package `@gigacad/cli` | `npm install -g @gigacad/cli` |

The web app decides which site to serve from the request's host (`apps/web/lib/hosts.ts`). On `gigacad.site`, product and sign-in paths redirect to `app.gigacad.site`. On `app.gigacad.site`, `/` is the dashboard and marketing paths redirect back to the marketing site.

## Accounts and monthly cost

| Account | Plan | Approximate cost |
|---|---|---|
| Cloudflare | Workers Paid (needed for the app's bundle size and CPU time) | $5 |
| Cloudflare R2 | Pay as you go | Free up to 10 GB, then $0.015 per GB-month. No egress fees |
| Supabase | Free while testing, Pro at public launch (daily backups, no pausing) | $0, then $25 |
| Railway | Hobby | $5 plus usage |
| npm | The `@gigacad` organization | Free for public packages |
| Email (SMTP) for Auth, e.g. Resend or Postmark | Free tier to start | $0 to start |
| GitHub and Google OAuth apps | Free | $0 |

## Steps

### 1. DNS

1. Add `gigacad.site` to Cloudflare and switch the Namecheap nameservers to the two Cloudflare gives you.
2. Add a redirect rule that sends `www.gigacad.site/*` to `https://gigacad.site/$1` (301).
3. Add the other records as each service comes up in the steps below.

### 2. R2 storage

1. **Person:** Enable R2 with a payment method.
2. **Agent:** Create the bucket `gigacad-prod`. Add a CORS rule for future browser uploads: allowed origin `https://app.gigacad.site`, methods `GET` and `PUT`, allowed headers `content-type` and `x-amz-checksum-sha256`.
3. **Person:** Create an R2 API token with Object Read & Write access to `gigacad-prod` only. Save the access key ID, secret, and account ID in a password manager, then put the S3 settings in the ignored `apps/api/.env.r2` file. Never put the credentials in this document or any tracked file.
4. **Gate: nothing else ships until this passes.** Run the storage test against R2. It proves R2 rejects altered uploads through the signed SHA-256 checksum, and that downloads keep their file names:

   ```sh
   set -a; . apps/api/.env.r2; set +a
   pnpm vitest run --config vitest.integration.config.ts apps/api/test/storage.int.test.ts
   ```

### 3. Supabase

1. Create the project in a US East region, next to the Railway region chosen in step 4.
2. Apply the schema:

   ```sh
   supabase link --project-ref <ref>
   supabase db push          # applies supabase/migrations
   ```

3. Configure Auth (Authentication settings in the dashboard):
   - Site URL: `https://app.gigacad.site`.
   - Redirect URLs, all on `https://app.gigacad.site`: `/**`, `/auth/callback**`, `/device**`, `/reset-password`.
   - Turn on email confirmation.
   - Set up custom SMTP, then copy `supabase/templates/confirmation.html` and `recovery.html` into the matching email templates. Local templates in `supabase/config.toml` are not applied to hosted projects.
   - Create GitHub and Google OAuth apps using the callback URL each provider's Supabase settings page shows. Keep the client secrets only in Supabase.
4. Note the connection string for the **Supavisor session-mode pooler** (port 5432 on the pooler host). The API uses postgres.js, which needs session mode for prepared statements, and the direct database host is IPv6-only, which Railway can't reach.
5. Hosted projects sign sessions with asymmetric keys, which the API verifies through JWKS. Leave `SUPABASE_JWT_SECRET` unset in production.
6. Check that Realtime is on for `project_events`. The migration adds the table to the `supabase_realtime` publication, and the web app uses it for live updates.

### 4. API on Railway

The service builds from `Dockerfile.api` at the repo root. It installs only the API and `packages/core`, builds both, and starts `node apps/api/dist/server.js`. Configure the service in the Railway dashboard. Don't add a `railway.json`: Railway has deprecated config-as-code files and stops reading them on 2026-12-01. Its replacement, Infrastructure as Code (`.railway/railway.ts`), isn't worth adopting for a single service yet.

1. Create a Railway project from the GitHub repo, deploying the `main` branch.
2. In the service settings:
   - Region: US East.
   - Deploy, Healthcheck Path: `/health`.
3. Set the service variables. `RAILWAY_DOCKERFILE_PATH` is required because Railway only detects a file named exactly `Dockerfile`:

   | Variable | Value |
   |---|---|
   | `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.api` |
   | `DATABASE_URL` | Supabase session pooler URL from step 3 |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
   | `S3_REGION` | `auto` |
   | `S3_BUCKET` | `gigacad-prod` |
   | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | R2 token from step 2 |
   | `S3_FORCE_PATH_STYLE` | `true` |
   | `WEB_ORIGIN` | `https://app.gigacad.site`. Device sign-in links and CORS use it |

   Railway sets `PORT` itself. The image already sets `HOST=0.0.0.0` and `NODE_ENV=production`.
4. Add the custom domain `api.gigacad.site` in Railway. In Cloudflare, create the CNAME Railway shows, set to **DNS only** (grey cloud) so Railway can issue the certificate.
5. Turn on "Wait for CI" in the service's source settings so a push to `main` deploys only after the GitHub checks in `.github/workflows/ci.yml` pass.
6. Check that `curl https://api.gigacad.site/health` returns `{"ok":true}`.

### 5. Web app on Cloudflare Workers

Already in the repo: `@opennextjs/cloudflare` and `wrangler` in `apps/web`, `apps/web/open-next.config.ts`, `apps/web/wrangler.jsonc` (custom-domain routes for `gigacad.site` and `app.gigacad.site`), and the `preview` and `deploy` scripts. Always call them with `pnpm --filter @gigacad/web run <script>`. Without `run`, `pnpm deploy` is pnpm's built-in deploy command, which does something else entirely.

1. Build `packages/core` once (`pnpm --filter @gigacad/core build`). Next bundles it from its build output.
2. `NEXT_PUBLIC_*` values are compiled into the build. Set them in the environment that runs the build:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (never a secret or service-role key) |
   | `NEXT_PUBLIC_GIGACAD_API_URL` | `https://api.gigacad.site` |
   | `NEXT_PUBLIC_GIGACAD_APP_URL` | `https://app.gigacad.site` |
   | `NEXT_PUBLIC_GIGACAD_SITE_URL` | `https://gigacad.site` |
   | `NEXT_PUBLIC_GITHUB_AUTH_ENABLED`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` | `true` once each provider works |

3. **Before the first deploy**, run `pnpm --filter @gigacad/web run preview` and check three things under the Workers runtime:
   - `proxy.ts`: the host split and Supabase session refresh.
   - Server actions: create a project and save picks.
   - Supabase SSR cookies: log in, reload, and log out.

   If OpenNext rejects the Node runtime for `proxy.ts`, make it edge-compatible. It only uses cookies and `@supabase/ssr`.

   Checked so far (2026-09-24, without a Supabase project): `next build` and the OpenNext build succeed, and the preview redirects a signed-out `/app` to `/login`. The three checks above still need a real Supabase project.
4. Deploy with `wrangler login` and then `pnpm --filter @gigacad/web run deploy`. After that, `deploy-web.yml` deploys every push to `main` (step 8).

### 6. Production smoke test

1. Sign up on `https://app.gigacad.site/signup`, confirm the email, and choose a handle.
2. Build the CLI (`pnpm --filter @gigacad/cli build`) and run `node clients/cli/dist/giga.js login`. It uses the production API by default. Approve the code at `app.gigacad.site/device`.
3. Create a scratch project, a branch, a clone, a checkout and a commit with the CLI.
4. In the web app, open a release request, pick, generate the candidate, approve, and release.
5. Run `giga release export 1 <dir>` and check the files match.
6. Check that `https://gigacad.site/login` redirects to the app host, and that a checkout made with the CLI appears in an open browser without a reload.

### 7. Publish the CLI

```sh
pnpm --filter @gigacad/cli publish     # publishConfig already sets public access
npx @gigacad/cli --version
```

The package is marked `UNLICENSED` (proprietary) and bundles everything into one file with no runtime dependencies.

### 8. CI/CD (`.github/workflows/`)

The workflows are in the repo. What's left is configuring GitHub:

- `ci.yml` runs on pull requests and pushes to `main`:
  - `check`: `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm --filter @gigacad/cli smoke`.
  - `api-image`: builds `Dockerfile.api`, the image Railway deploys.
  - `integration`: starts SeaweedFS (the S3 stand-in for R2) from `docker-compose.yml` and runs the storage test. Then it starts a local Supabase stack (`supabase start` applies the migrations) and runs `pnpm test:integration`. This is the first place those tests run automatically. There is no browser end-to-end suite yet.
- `deploy-web.yml` runs after CI succeeds on a push to `main`. It stays off until you set the repository variable `DEPLOY_WEB` to `true`. It needs:
  - Secrets `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`.
  - The `NEXT_PUBLIC_*` values from step 5 as repository variables.
  - A `production` environment. Add required reviewers to it if deploys should need approval.
- Protect `main` and require the `check`, `api-image`, and `integration` jobs.
- Railway deploys the API on its own once CI passes (step 4).
- **Migrations are manual.** Run `supabase db push` against production after review, before merging any pull request that adds a migration.

### 9. Operations

- Set up uptime checks on `https://api.gigacad.site/health` and `https://app.gigacad.site`.
- Supabase Pro takes daily backups. Upgrade before public launch.
- Logs: Railway for the API, `wrangler tail` or the Workers dashboard for the web app.
- Set a spending alert on R2 storage.
- Before opening public sign-ups, finish step 3.3: SMTP, email templates, and OAuth.

## Status

| Step | Done | Notes |
|---|---|---|
| 1.1 `www` redirect | Yes | 2026-09-24: user saved the rule; a live request to `https://www.gigacad.site/deployment-check?x=1` returned 301 to `https://gigacad.site/deployment-check?x=1` |
| 1.2 Proxied `AAAA www 100::` | Yes | 2026-09-24: Cloudflare DNS API confirmed `www.gigacad.site` points to `100::` with proxy enabled; old parking CNAME is gone |
| 1.3 Remove imported apex and `app` address records | Yes | 2026-09-24: Cloudflare DNS API confirmed no A/AAAA/CNAME records for `gigacad.site` or `app.gigacad.site`; apex MX and TXT records remain |
| 1.4 Cloudflare zone Active | Yes | 2026-09-24: Cloudflare Zones API reported `gigacad.site` as `active` |
| 2.1 R2 enabled | Yes | 2026-09-24: bucket creation succeeded after user reached R2 bucket setup |
| 2.2 Bucket `gigacad-prod` | Yes | 2026-09-24: bucket created and verified in Eastern North America, Standard storage |
| 2.2 Bucket CORS | Yes | 2026-09-24: Cloudflare API confirmed origin `https://app.gigacad.site`, methods GET/PUT, and headers `content-type`/`x-amz-checksum-sha256` |
| 2.3 Bucket-scoped API token and ignored env file | Yes | 2026-09-24: user provided credentials in ignored `apps/api/.env.r2.rtf`; converted locally to R2-only plain text `apps/api/.env.r2` with mode 600; no credential values entered in tracked files |
| 2.4 R2 storage gate | Yes | 2026-09-24: `pnpm vitest run --config vitest.integration.config.ts apps/api/test/storage.int.test.ts` passed against R2 (1 test) |
| 3.1 Supabase project | Yes | 2026-09-24: created `GigaCAD Production` in `us-east-1`, ref `gaxicutwgacxekqcsnpg`, URL `https://gaxicutwgacxekqcsnpg.supabase.co`. Database password stored outside the repo in macOS Keychain. Earlier empty `ewvkxsicxiigojhmttjp` project remains in `us-west-2` and is not the deployment target |
| 3.2 Schema migration | Yes | 2026-09-24: CLI linked East project; pushed `20260924000000_core_schema.sql` and `20260925012709_harden_security_definer_functions.sql`. Remote migration history matches both local files; security advisor returned zero warnings |
| 3.3 Realtime publication | Yes | 2026-09-24: queried `pg_publication_tables`; `public.project_events` is in `supabase_realtime` |
| 3.4 Auth settings | Yes | 2026-09-24: site URL and all four redirect patterns pushed to East project; email confirmation enabled. Config diff shows no remaining declared differences |
| 3.5 Custom email | Yes | 2026-09-24: Resend domain `send.gigacad.site` (us-east-1), DKIM and SPF records added by Resend's Cloudflare auto-configure. Supabase SMTP: `smtp.resend.com:465`, sender `no-reply@send.gigacad.site`. Both templates uploaded through the Management API and match `supabase/templates`. A test sign-up sent a confirmation email; the test user was deleted. DMARC `v=DMARC1; p=none;` at `_dmarc` added by the user |
| 3.6 GitHub and Google OAuth | | Person-owned provider setup can wait until before public launch |
| 3.7 Supavisor session pooler URL | Yes | 2026-09-24: `aws-0-us-east-1.pooler.supabase.com:5432`, user `postgres.gaxicutwgacxekqcsnpg`. The API ran locally against it: `/health` answered, database queries and prepared statements worked. The full URL is in the ignored `apps/api/.env.railway` with the other Railway variables; the password is in the macOS Keychain (`gigacad-supabase-prod-east-db`) |
| 4. Railway | | `Dockerfile.api` in repo. Its build steps and `/health` checked outside Docker 2026-09-24. CI builds the image |
| 5. Web | | Config and scripts in repo. Build and signed-out preview checked 2026-09-24 |
| 6. Smoke test | | |
| 7. CLI | | |
| 8. CI/CD | | Workflows in repo. 2026-09-24: `main` protected, requiring `check`, `api-image`, and `integration`. GitHub secrets, variables, and the `production` environment not set |
| 9. Operations | | |
