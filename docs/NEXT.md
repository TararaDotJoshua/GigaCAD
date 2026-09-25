# What's next

Where GigaCAD stands and what to do next, in order. `docs/PLAN.md` is the full product plan, and `docs/DEPLOYMENT.md` tracks each deployment step. Update this file as items finish.

## Where things stand (2026-09-25)

Live and verified in production:

- Marketing site at `gigacad.site`, product at `app.gigacad.site` (Cloudflare Workers), API at `api.gigacad.site` (Railway), Supabase project `gaxicutwgacxekqcsnpg`.
- Sign-up with confirmation email through Resend (`send.gigacad.site`).
- `@gigacad/cli` 0.1.0 on npm.
- CI on every pull request (`check`, `api-image`, `integration`, `e2e`). `main` is protected. Merges deploy the web app automatically, and Railway deploys the API after CI.
- The release flow, end to end. On `tararajoshua/smoke-test`: v1 and v2 from the CLI, v3 picked in the web app (keep main on a conflict, take a branch file, replace a part), approved, and released. `giga release export 3` matched every file byte for byte, and the replacement kept the old part's item ID.
- Sharing. A second account viewed a project shared with it.
- Live updates. Project pages refresh on their own when something happens, including on private projects (fixed in #13).
- A browser test in CI (`e2e` job, `apps/web/e2e/`): the release flow in the web app, live refresh, and the HTTP status of every page type. It's required on `main`.
- `scripts/check-site.sh` checks the status of every page type on the live site. It runs after each web deploy and every 15 minutes (`.github/workflows/uptime.yml`). GitHub emails a failed run.

## 1. Finish the launch checklist

These need the owner's accounts. Everything else before the next phase is done.

- **GitHub and Google sign-in (deployment step 3.6).** Create the two OAuth apps with the callback URL `https://gaxicutwgacxekqcsnpg.supabase.co/auth/v1/callback`:
  - GitHub: Settings → Developer settings → OAuth Apps → New OAuth App. Homepage `https://gigacad.site`.
  - Google: Google Cloud console → APIs & Services → Credentials → Create OAuth client ID (Web application), after configuring the consent screen. Authorized JavaScript origin `https://app.gigacad.site`.

  Put the client IDs and secrets in the ignored `supabase/.env.oauth` (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and run `scripts/enable-oauth.sh`. It turns the providers on in Supabase, sets the `NEXT_PUBLIC_*_AUTH_ENABLED` variables, and redeploys the web app.
- **Paid plans (deployment step 10).** The plans, storage limits, pricing page, and Stripe integration are built. Create a Stripe account, run `stripe:setup` in test mode, set the API's two Stripe variables and `NEXT_PUBLIC_BILLING_ENABLED`, and test a checkout. Then repeat in live mode.
- **R2 spending alert (step 9).** Cloudflare dashboard → Notifications → Add → Usage Based Billing → R2 storage, with a monthly threshold. The API token agents can use has no notification permissions.
- **Supabase Pro** before public sign-ups, for daily backups and no pausing.

## 2. Cleanup

- Keep or delete `tararajoshua/smoke-test`.
- The test accounts `tararajoshua+ui-review`, `+rt-review`, and `+live-check` have soft-deleted projects and revoked sessions. Remove them once their projects' 30-day grace period ends (from 2026-09-25 at the latest).

## 3. Product work

Following the phases in `docs/PLAN.md`:

1. **Windows drive (phase 3).** A `GigaCAD\` drive in File Explorer where SolidWorks opens and saves files directly. It needs a sync root, file hydration, the save pipeline that produces autosaves, read-only enforcement for branches you haven't checked out, a context menu, and a tray app. Testing needs a Windows laptop with SolidWorks.
2. **SolidWorks add-in (phase 4).** A task pane, a read-only banner, reference and preview export, and rebuilding release candidates.
3. **Worker (phase 5).** STL and STEP to glTF previews, thumbnails, blob garbage collection, and stale-lock notifications.
4. **Public sharing (phase 6).** Explore, fork, and stars.
5. **macOS client and other CAD programs (phase 7).**

## Working notes

- Every change to `main` goes through a pull request. All four CI jobs must pass, and auto-merge is on.
- Check deploys by HTTP status for each kind of page (marketing, docs, product signed out and signed in), not by looking for text in the page.
- A CLI release means bumping the version in `clients/cli/package.json`, then running `pnpm --filter @gigacad/cli publish` from `main`. npm asks for a passkey confirmation in the browser.
- Docker isn't available on the development Mac, so integration tests and the API image build run only in CI.
