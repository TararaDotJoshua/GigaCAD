# What's next

Where GigaCAD stands and what to do next, in order. `docs/PLAN.md` is the full product plan, and `docs/DEPLOYMENT.md` tracks each deployment step. Update this file as items finish.

## Where things stand (2026-09-24)

Live and verified in production:

- Marketing site at `gigacad.site`, product at `app.gigacad.site` (Cloudflare Workers), API at `api.gigacad.site` (Railway), Supabase project `gaxicutwgacxekqcsnpg`.
- Sign-up with confirmation email through Resend (`send.gigacad.site`).
- `@gigacad/cli` 0.1.0 on npm.
- CI on every pull request (`check`, `api-image`, `integration`). `main` is protected. Merges deploy the web app automatically, and Railway deploys the API after CI.
- The release flow, end to end. On `tararajoshua/smoke-test`: v1 and v2 from the CLI, v3 picked in the web app (keep main on a conflict, take a branch file, replace a part), approved, and released. `giga release export 3` matched every file byte for byte, and the replacement kept the old part's item ID.
- Sharing. A second account viewed a project shared with it.

## 1. Fix live updates on private projects

Pages should refresh on their own when something happens in a project, like a checkout, an approval, or a release. Today they don't on private projects; you have to reload.

What's known:

- `apps/web/components/product/LiveRefresh.tsx` subscribes to Supabase Realtime inserts on `project_events` and calls `router.refresh()`.
- The server side works. An anonymous subscriber to a public project received `branch_created` within seconds.
- In a signed-in headless browser on a private project, the page never refreshed. The channel's join message appeared to carry no access token.

Likely cause: the browser subscribes before its session has loaded, so it joins as anonymous, and row-level security (`private.can_read_project`) filters out every event.

To do:

1. Before subscribing, load the session and pass its token to Realtime (`supabase.auth.getSession()`, then `supabase.realtime.setAuth(token)`). Also update the token when the session refreshes.
2. Verify in a signed-in browser on a private project: trigger an event through the API and check that the page refreshes without a reload.
3. Mark step 6 done in `docs/DEPLOYMENT.md`.

## 2. Finish the launch checklist

- **GitHub and Google sign-in (deployment step 3.6).** The owner creates the two OAuth apps and puts the client secrets in Supabase. Then set `NEXT_PUBLIC_GITHUB_AUTH_ENABLED` and `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` to `true` in the GitHub repository variables and redeploy.
- **Operations (step 9).** Add uptime checks on `https://api.gigacad.site/health` and `https://app.gigacad.site`. Set a spending alert on R2.
- **Supabase Pro** before public sign-ups, for daily backups and no pausing.
- **A browser test in CI.** A Playwright test of pick files, then generate the candidate, approve, and release. It should also request every page type and assert its HTTP status. A 500 on every docs page once went unnoticed because a check matched page content instead of the status code.

## 3. Cleanup

- Delete the `tararajoshua/realtime-check` project, which is public and was only for testing. Keep or delete `tararajoshua/smoke-test`.
- Delete `apps/api/.env.railway` and `apps/api/.env.r2.rtf`, local copies of secrets that Railway now holds. Keep `apps/api/.env.r2` for re-running the R2 storage test.
- Delete the unused US West Supabase project (`ewvkxsicxiigojhmttjp`).
- The test accounts `tararajoshua+ui-review` and `tararajoshua+rt-review` have soft-deleted projects and revoked sessions. Remove them once their projects' 30-day grace period ends.

## 4. Product work

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
