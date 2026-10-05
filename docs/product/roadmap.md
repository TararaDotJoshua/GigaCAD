# Roadmap

Where GigaCAD stands and what to do next, in order. [plan.md](plan.md) is the full product design, and [the deployment guide](../operations/deployment.md) tracks each production setup step. Update this file as items finish.

## Where things stand (2026-10-05)

Live and verified in production:

- Marketing site at `gigacad.site`, product at `app.gigacad.site` (Cloudflare Workers), API at `api.gigacad.site` (Railway), Supabase project `gaxicutwgacxekqcsnpg`.
- Sign-up with confirmation email through Resend (`send.gigacad.site`). `@gigacad/cli` 0.1.0 on npm.
- The release flow, end to end. On `tararajoshua/smoke-test`: v1 and v2 from the CLI, v3 picked in the web app (keep main on a conflict, take a branch file, replace a part), approved, and released. `giga release export 3` matched every file byte for byte, and the replacement kept the old part's item ID.
- Sharing, and live updates on private projects (#13).
- Paid plans (Maker, Builder, Workshop, Studio) on sale through Stripe Managed Payments, with storage limits enforced.
- Background jobs in the API (#22): unused files are cleaned up, deleted projects are purged after 30 days, and stale checkouts get an email reminder.
- 3D previews in the browser (#23) and thumbnails (#27) for STL, OBJ, 3MF, STEP, and IGES files.
- Public sharing (#24): Explore, user profiles, stars, and forks. Restoring deleted projects within 30 days (#25).
- GitHub-style user pages (#31): avatar, bio, contribution graph, recent activity, and a Starred tab.
- The project file directory (#34): root files and folders with their own revisions, next to `Branches` and `Releases`. See [the file directory plan](../ui/file-directory-plan.md).
- GigaCAD for macOS (`clients/desktop`, #42–#44), verified against production. Nothing is published to `downloads.gigacad.site` yet, so the download links return 404.
- GigaCAD for Windows, W1–W4 and W7 (#46–#50): the desktop app runs on Windows with the CAD plugin host started, locks files and folders, adds the File Explorer menu, folder icons, and `giga.cmd`, answers the add-in's pipe requests from the sync engine, and has a release workflow and download link for the installer. The installer isn't published yet, so the Windows download returns 404.
- CI on every pull request, with `check`, `api-image`, `integration`, `e2e`, and `windows` required on `main`. `scripts/check-site.sh` checks every page type on the live site after each web deploy and every 15 minutes.

## 1. Land the work in flight

- **Web UX fixes.** Phases 1–6 of [the web UX plan](../ui/web-ux-plan.md) are merged: #52 (phase 1), #53 (phases 2–4), #54 (phase 5), and #55 (phase 6). Phases 7 (collaboration, account, billing) and 8 (polish) are in stacked PRs #58 and #59. Before merging #58, upload the email change template (see its description).
- **On a Windows PC (needs the owner):** install the CI-built installer and test sign-in, sync, check-out from the right-click menu, saving in SolidWorks, locks, icons, and the tray. Then run the Desktop release workflow with `windows` checked, and set up code signing.

## 2. Finish the launch checklist

These need the owner's accounts.

- **GitHub and Google sign-in (deployment step 3.6).** Create the two OAuth apps with the callback URL `https://gaxicutwgacxekqcsnpg.supabase.co/auth/v1/callback`:
  - GitHub: Settings → Developer settings → OAuth Apps → New OAuth App. Homepage `https://gigacad.site`.
  - Google: Google Cloud console → APIs & Services → Credentials → Create OAuth client ID (Web application), after configuring the consent screen. Authorized JavaScript origin `https://app.gigacad.site`.

  Put the client IDs and secrets in the ignored `supabase/.env.oauth` (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and run `scripts/enable-oauth.sh`. It turns the providers on in Supabase, sets the `NEXT_PUBLIC_*_AUTH_ENABLED` variables, and redeploys the web app.
- **Stripe follow-ups.** Set a support email in Stripe (Managed Payments forwards customer questions there), delete the sandbox's webhook to `api.gigacad.site`, move the API to a restricted live key (`rk_live_`) with the permissions in deployment step 10, and remove `sk_live` from `apps/api/.env.stripe`.
- **R2 spending alert (step 9).** Cloudflare dashboard → Notifications → Add → Usage Based Billing → R2 storage, with a monthly threshold. The API token agents can use has no notification permissions.
- **Supabase Pro** before public sign-ups, for daily backups and no pausing.
- **First macOS release.** Back up `~/.config/gigacad/desktop-update-key.pem` (the update signing key) in a password manager; losing it means every installed copy needs a new DMG. Store it with `gh secret set DESKTOP_UPDATE_KEY < ~/.config/gigacad/desktop-update-key.pem`, check that the `CLOUDFLARE_API_TOKEN` secret can write to R2, then run the `Desktop release` workflow from `main` with `dmg` checked.

## 3. Cleanup

- Keep or delete `tararajoshua/smoke-test`.
- Remove the test accounts `tararajoshua+ui-review`, `+rt-review`, `+live-check`, and `+billing-check` after about 2026-10-25, when their projects' 30-day grace period ends.
- The worktree `~/Documents/GigaCAD-desktop` is a detached HEAD at an old, merged commit and can be removed.
- Explore listed no public projects on 2026-10-05, so `check-site.sh` skips its user-page check. Make a project public again, or seed one.

## 4. Product work

Following the phases in [plan.md](plan.md):

1. **Windows app (phase 3).** W1–W4 and W7 are merged (#46–#50). What's left needs the Windows PC, above. See [the Windows app plan](../clients/windows-app-plan.md).
2. **SolidWorks add-in (phase 4, milestones W5–W6).** Task Pane, read-only banner, references, reconnecting, the pipe server identity check, STL export on version commits, and candidate rebuilds with STEP AP242 and fine STL. It builds only on a computer with SolidWorks installed, because the interop DLLs come from the install. The installer must also register the add-in.
3. **macOS client (phase 7).** The folder-based app is built. Next: try it on a clean Mac account, then decide whether viewers' root folders should be locked and whether local copies of archived branches should be removed. A File Provider version needs a Developer ID.
4. **Other CAD programs (phase 7).** Fusion, FreeCAD, and Onshape exports through generic parsers.
5. **Later.** A Windows Cloud Files virtual drive for on-demand files, and a streaming ZIP "Download all" endpoint (web UX phase 6).

## Open product questions

- Should archived branches be hidden under `Branches` and in search?
- Should viewers' root folders be locked in the desktop app?
- Should local copies of archived branches be removed?
- The 30-day price-change notice in the terms was assumed, not confirmed.
