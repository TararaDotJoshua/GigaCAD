# What's next

Where GigaCAD stands and what to do next, in order. `docs/PLAN.md` is the full product plan, and `docs/DEPLOYMENT.md` tracks each deployment step. Update this file as items finish.

## Where things stand (2026-09-25)

Live and verified in production:

- Marketing site at `gigacad.site`, product at `app.gigacad.site` (Cloudflare Workers), API at `api.gigacad.site` (Railway), Supabase project `gaxicutwgacxekqcsnpg`.
- Sign-up with confirmation email through Resend (`send.gigacad.site`).
- `@gigacad/cli` 0.1.0 on npm.
- CI on every pull request (`check`, `api-image`, `integration`). `main` is protected. Merges deploy the web app automatically, and Railway deploys the API after CI.
- The release flow, end to end. On `tararajoshua/smoke-test`: v1 and v2 from the CLI, v3 picked in the web app (keep main on a conflict, take a branch file, replace a part), approved, and released. `giga release export 3` matched every file byte for byte, and the replacement kept the old part's item ID.
- Sharing. A second account viewed a project shared with it.
- Live updates. Project pages refresh on their own when something happens, including on private projects (fixed in #13).
- A browser test in CI (`e2e` job, `apps/web/e2e/`): the release flow in the web app, live refresh, and the HTTP status of every page type.

## 1. Finish the launch checklist

- **GitHub and Google sign-in (deployment step 3.6).** The owner creates the two OAuth apps and puts the client secrets in Supabase. Then set `NEXT_PUBLIC_GITHUB_AUTH_ENABLED` and `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` to `true` in the GitHub repository variables and redeploy.
- **Operations (step 9).** Add uptime checks on `https://api.gigacad.site/health` and `https://app.gigacad.site`. Set a spending alert on R2.
- **Supabase Pro** before public sign-ups, for daily backups and no pausing.
- **Require the `e2e` CI job on `main`.** It isn't in the branch protection rule yet. Note it runs `next start`, not the OpenNext Workers build, so a Workers-only failure (like the docs 500) still needs a check against the deployed site.

## 2. Cleanup

- Delete the `tararajoshua/realtime-check` project, which is public and was only for testing. Keep or delete `tararajoshua/smoke-test`.
- Delete the unused US West Supabase project (`ewvkxsicxiigojhmttjp`).
- The test accounts `tararajoshua+ui-review` and `tararajoshua+rt-review` have soft-deleted projects and revoked sessions, and `tararajoshua+live-check` (from the live-update check) has a soft-deleted project. Remove them once their projects' 30-day grace period ends.

## 3. Product work

Following the phases in `docs/PLAN.md`:

1. **Windows drive (phase 3).** A `GigaCAD\` drive in File Explorer where SolidWorks opens and saves files directly. It needs a sync root, file hydration, the save pipeline that produces autosaves, read-only enforcement for branches you haven't checked out, a context menu, and a tray app. Testing needs a Windows laptop with SolidWorks.
2. **SolidWorks add-in (phase 4).** A task pane, a read-only banner, reference and preview export, and rebuilding release candidates.
3. **Worker (phase 5).** STL and STEP to glTF previews, thumbnails, blob garbage collection, and stale-lock notifications.
4. **Public sharing (phase 6).** Explore, fork, and stars.
5. **macOS client and other CAD programs (phase 7).**

## Working notes

- Every change to `main` goes through a pull request. All three CI jobs must pass, and auto-merge is on.
- Check deploys by HTTP status for each kind of page (marketing, docs, product signed out and signed in), not by looking for text in the page.
- A CLI release means bumping the version in `clients/cli/package.json`, then running `pnpm --filter @gigacad/cli publish` from `main`. npm asks for a passkey confirmation in the browser.
- Docker isn't available on the development Mac, so integration tests and the API image build run only in CI.
