# Web app UX fixes: plan

This plan covers the findings from the 2026-09-30 audit of the web app: a code read of five flows, then a visual walkthrough on production (public pages) and a local stack (signed-in pages). Paths are relative to `apps/web/` unless they start with `apps/api/` or `supabase/`.

Status (2026-10-05): phases 1–6 are merged: #52 (phase 1), #53 (phases 2–4), #54 (phase 5), and #55 (phase 6). Phases 7 and 8 are next.

## Decisions

The owner approved every recommendation below on 2026-09-30. Product-app headings drop the trailing period (8.2), and there's no "GigaCAD" kicker above headings.

1. **What the project root shows.** Today a released project opens on two folder rows, Branches and Releases, and its CAD files are two clicks down.
   - **Recommended:** keep the directory, but add a "Latest release" section above it on the root page only. It shows the first 10 files of the newest release, links to the full release, and has a download-all button.
   - Alternative: make the root open *inside* the latest release, with root files moved to a "Files" folder. This is a bigger change to the directory model in [the file directory plan](file-directory-plan.md).
2. **One word for file history.** Root files have "revisions"; branches have "versions" and "autosaves". DESIGN.md's word list says Version.
   - **Recommended:** keep "Revision" for root files, because they really are a separate history. Explain it once, in the root intro text and the entry page. Never use "Revision" anywhere else.
3. **Release names.** Releases have only a number. `releases.release_request_id` already exists.
   - **Recommended:** show the release request's title as the release name wherever a release appears. No migration needed. Direct API releases, which have no request, show "v3" alone.
4. **Tags vs releases.** "Tags" are file labels, but the Releases card uses a tag icon.
   - **Recommended:** keep the name "Tags" and change the release icon everywhere to the padlock that is already used inside the Releases folder. Renaming tags to "Labels" touches the API and CLI, which isn't worth it.
5. **Email and password changes.** The Account page has neither.
   - **Recommended:** add both now, using Supabase `updateUser`. Email change uses the existing double-confirm setting (`supabase/config.toml`, `double_confirm_changes = true`).

## Phase 1: bugs (small, ship first)

| # | Bug | Fix | Files |
|---|---|---|---|
| 1.1 | "Back to site" and the logo on auth pages link to `/`. On app.gigacad.site that redirects to `/login` (confirmed on production). | Link to the marketing site (`NEXT_PUBLIC_GIGACAD_SITE_URL`, falling back to `https://gigacad.site`). Add the constant to `components/site.ts`. | `app/(auth)/layout.tsx`, `components/site.ts` |
| 1.2 | A finished release request shows "no file differences" and "into main v2", because the preview is recomputed against the *current* main. | For released or closed requests, diff against the request's `target_release_id` (the main it was generated against), not the latest release. Show "into main v1" from that same field. Keep the pick rows read-only. | `apps/api/src/services/releaseRequests.ts` (`candidateInputs`, detail), `release-requests/[number]/page.tsx` |
| 1.3 | Approvals card says "0 of 1" next to an "Approved" badge on a released request. | After release, count the approvals recorded on the released candidate instead of reading `evaluation`, which is null. | same page, and the API detail if needed |
| 1.4 | Unsaved picks are wiped when a live refresh changes `updatedAt` (`<PickEditor key={request.updatedAt}>`). | Key on `request.id`. When the server picks change underneath a dirty draft, keep the draft and show "Picks changed elsewhere. Reload them?" | `release-requests/[number]/page.tsx`, `components/product/PickEditor.tsx` |
| 1.5 | The home-page timeline SVG overflows at 390px (784px wide), cutting off steps 3–5. | Below 700px, draw the diagram vertically or scale it with `viewBox` and `width: 100%`. | `app/(marketing)/page.tsx`, `app/globals.css` |
| 1.6 | The fork form pre-fills an address the user already has (forking your own project). | Pre-fill `<slug>-fork`, or the next free `-2`, `-3`. Validate live like `/new` does. | `[project]/fork/page.tsx` |
| 1.7 | The email-confirm "Continue" button shows nothing while it works (several seconds). | Use a pending-aware submit button ("Confirming…", disabled). Add the auth header and logo; the page lives outside the `(auth)` layout. | `app/auth/confirm/page.tsx` |

**Tests:** an e2e check that the auth "Back to site" href is the site URL. An API integration test that a released request's detail still lists its picks. A unit test for the fork slug suggestion.

## Phase 2: loading, errors, and not losing your place

1. **Loading states.** Add `loading.tsx` skeletons for `(product)`, `[owner]/[project]`, and `[project]/tree/[...path]`. Match the table and rail shapes so the layout doesn't jump. The project skeleton wraps only the project root (#53). A loading boundary sends a page with a 200 before it renders, so over pages that can be missing (a release, commit, or folder) it turns their 404 into a 200.
2. **Error pages.** Add a branded `app/not-found.tsx` and an `(product)/[owner]/[project]/not-found.tsx` with the sidebar, a plain sentence, and links to "Your projects" and "Explore". Add `(product)/error.tsx` with a Retry button that keeps the shell, and `global-error.tsx` as the last resort.
3. **Return after login.**
   - `lib/session.ts` `requireAccessToken()` redirects to plain `/login`. Pass `next` using the request path. Set an `x-pathname` header in `proxy.ts` so server code can read it.
   - `lib/product.ts:96` keeps only `/owner/slug` for private projects. Use the same header to keep the full deep path.
   - Sidebar "Log in" (`SidebarNav.tsx:97`) drops the query string, and "Sign up" plus "Forgot password?" drop `next`. Carry the full path and query through all of them.
4. **Signed-in users on auth pages.** Redirect `/login` and `/signup` to `next` (or the dashboard) when a session exists. On the marketing header, show "Dashboard" instead of "Log in / Start a project" when the session cookie is present.
5. **Reset password without a valid link.** Check for a recovery session on load. If there isn't one, show "This link has expired" and a link to `/forgot-password` instead of the form. Map Supabase auth errors to plain sentences in one place (`lib/messages.ts`).

**Tests:** e2e cases that a deep link to a private branch page returns to that page after login, and that an unknown project shows the branded 404 with a status of 404.

## Phase 3: onboarding

1. **After signup.** Replace the form with a "Check your inbox at {email}" panel. It has a "Resend email" button (`supabase.auth.resend`), a "Wrong address?" link back to the form, and a note about spam folders. Remove "then return here to log in".
2. **Signup form.** Show "At least 8 characters" under the password field. Carry the typed email between `/login` and `/signup` with `?email=`.
3. **Choosing a handle.**
   - Suggest a handle from the email's local part, checked for availability, and pre-fill it.
   - Hide the placeholder `@user-…` handle in the sidebar until a real handle is saved.
   - Keep the "New project" button visible but disabled, with a hint ("Choose a handle first"), instead of hiding it.
   - `/new` without a handle: redirect with a notice instead of silently.
4. **Empty project.** When the root has no files and no releases, show a getting-started panel above the directory with three choices:
   - Upload files (opens the picker)
   - Install the desktop app (links `/download`)
   - Use the CLI (`giga clone` snippet)

   Show the same panel, smaller, on the dashboard empty state.
5. **Device approval.** Show "Signed in as @handle" above the Approve button. Leave a gap between the lookup button and the error box. After approval, show a dedicated "Device approved. You can close this tab." state instead of sending the user to the dashboard.
6. **Default redirects.** Default the post-login target to `dashboardPath()` rather than `/app`, to skip the extra redirect on the app host.

## Phase 4: project page structure

1. **Latest release on the root.** This implements decision 1: a "Latest release" section showing the release name, number, date, and first 10 files, with "View all N files" and "Download all".
2. **Activity feed.**
   - Show 5 items with "View all activity". Add an `activity` page, or a `?view=activity` view of the Recent tab.
   - Collapse runs of checkout and checkin by the same person on the same branch into one line ("worked on longer-arms").
   - Render the rail cards (Tags, Releases, Activity) only on the root, not on every subfolder page.
3. **Icons.**
   - Releases (root row, Releases folder rows, rail card, sidebar) all use the padlock.
   - Assemblies keep the cube. Branches keep the branch icon.
   - Check what `PartIcon` looks like at 16px. In the screenshots it reads as a camera, so redraw it as a simple prism from `components/parts.tsx`.
4. **Empty folder rows.** Show a count on the Branches and Releases rows ("2 branches", "1 release") so the Modified and Size columns aren't blank.
5. **Remove repetition.** The project name appears in the breadcrumb, the heading, the table caption, and the sidebar. Drop the table caption at the root; keep it in subfolders, where it's the folder name.
6. **Star on your own private project.** Hide Star on private projects, where it only ever counts you.

## Phase 5: files, branches, and commits

1. **One file table.** Replace `FileTable` on branch, release, and commit pages with `DirectoryTable` in a read-only mode: folders, dates, preview, download, and per-row history links. Drop the "Item" column, which shows the first 8 characters of an ID. Show the full item ID in a file's detail page if it's needed at all.
2. **History headings.** In branch history and on the commit page, the heading is the message ("Longer arms, add shock"). The kind (Version or Autosave) is a small badge next to it. When there is no message, fall back to "Version" or "Autosave".
3. **Commit page.**
   - Add Branches to the breadcrumb.
   - Link each changed file to its file page, with preview and download.
   - Add "Previous version" and "Next version" links, and a heading-level "Back to longer-arms".
4. **Branch page.**
   - When frozen, link to the open release request ("Frozen for release request #2").
   - Add a "Changes from v1" section that lists added, edited, and removed files against the branch's base release, using the same diff the request uses.
5. **Locks.**
   - Show lock age in rows and the sidebar ("@sam, 2h").
   - For owners and maintainers, show "Force-release lock" next to it, with a sentence on what that does.
   - For everyone else, a "How checkouts work" link to the docs.
6. **Uploads.**
   - Add a drop zone over the file table.
   - Show per-file progress bars.
   - Keep going after a failed file and report failures at the end.
   - Ask about name collisions once for the whole batch ("3 files already exist: save as new revisions?") instead of one browser confirm per file.
7. **Row actions on touch screens.** Add a visible "⋯" button per row that opens the existing `EntryMenu`. Show the "Right-click…" hint only on devices with a mouse, using `@media (hover: hover)`.
8. **Search scope.** Search the current folder by default, with an "All of this project" toggle.
9. **Download errors.** Show failures as inline text next to the button, not only in its `title` tooltip.
10. **Entry page.** Collapse "Rename or move" behind a button so the rail isn't mostly a form. Use the file name in the tab title.

## Phase 6: release requests and releases

1. **What the release will contain.** Add a summary bar above the picks: "v3 will change 3 files: 2 edited, 1 added, 0 removed". It updates live as picks change. Each row gets a Preview button that opens the 3D preview for main and branch side by side where both exist.
2. **Fewer steps.**
   - "Save picks" also regenerates the candidate. Remove the separate Generate button; keep "Regenerate" only for when main has moved on.
   - When the requester may approve their own request and only one approval is needed, merge "Approve" into "Release vN". The confirm text says it approves and releases.
3. **Next step.** Add a banner at the top of the request that always says what happens next: "Save your picks", "Waiting for 1 approval from a maintainer", "Ready to release v3", "Released as v3".
4. **Rebuild card.** Show it only when the project requires a clean rebuild, or a rebuild report exists.
5. **Opening a request.** Say in the form that opening freezes the branch, and link to where it can be closed. Keep the confirmation to one sentence.
6. **Finished requests.** After phase 1.2, also show "Released as v2" as a link whether or not v2 is still the latest.
7. **Release pages.**
   - Name each release after its request (decision 3), in the list, on the release page, in the rail card, and in the header's "Latest release" link.
   - Add "Changes from v1" on the release page.
   - Add "Download all" as a zip. This needs an API endpoint that streams a zip of the manifest. The browser can't build multi-gigabyte zips.
   - Show notes in full on the release page and in the list.
8. **Branches after release.** Hide released branches from the Branches folder and sidebar by default, behind a "Show released" toggle.
9. **List pages.** Make Active/All on release requests the same segmented control as All files/Recent/Favorites. Add counts.

## Phase 7: collaboration, account, and billing

1. **Storage-full errors.** Detect `storage_full` in `UploadFiles`.
   - Owners see "Out of storage (4.9 of 5 GB)" with an "Upgrade" link to `/settings/billing?from=<current path>`.
   - Collaborators see "@owner is out of storage. Ask them to free up space or upgrade."
   - Remove "on gigacad.site" from the API message (`apps/api/src/services/billing.ts:55`).
2. **Warn before storage runs out.** At 80% and above, show a thin banner in the product shell with usage and an Upgrade link. It can be dismissed per session. At 100%, it can't be dismissed.
3. **Stripe return.** Carry `from` through checkout and portal return URLs. On success show "Back to <project>". On cancel show "No changes were made." If the webhook hasn't landed after the retry window, say "Still processing. Refresh in a minute."
4. **Plan buttons.** Label paid-plan actions "Change or cancel in Stripe" so it's clear they leave the site. Remove the redundant "Plan / Free" block above the plans table.
5. **Members.**
   - Handle autocomplete, using an existing profile search or a new `GET /v1/profiles?q=`.
   - A role select on each member row, instead of re-adding the member.
   - One-line role descriptions under the select.
   - A note that members' uploads count against the owner's storage.
   - Rename the button from "Add or update member" to "Add member".
   - Notify the added person by email and with a "Shared with you" section on their dashboard.
6. **Project settings.**
   - Say "Address" everywhere (delete confirmation included), not "slug".
   - Title the delete section "Delete project", with a red-bordered card.
   - After delete, the dashboard notice says restore is under Account.
   - Changing visibility to public asks for confirmation.
   - Under "Eligible people", explain that people are in addition to the roles checked above.
7. **Account page.**
   - Add Email (change with confirmation) and Password (change) sections.
   - Style the avatar picker like the rest of the forms, with one step: choosing a file uploads it.
   - Don't nest Account under "Your projects" in the breadcrumb.
8. **Fork button.** Show it disabled with a tooltip ("Forks start from a release. This project has none yet.") instead of hiding it.
9. **Explore.** Write separate empty-state copy for signed-out visitors ("No public projects yet. Check back soon."). Don't label the sidebar "This project" on Explore.

## Phase 8: consistency and polish

1. **Tab titles.** Every page gets `generateMetadata`:
   - Auth pages: "Log in", "Create account" and so on.
   - `/device`: "Approve a device".
   - Branch pages: the branch name. Commit pages: the commit message. Release request pages: "#N title".
   - Entry pages: the file name. Tree pages already have titles.
2. **Headings.** DESIGN.md says headlines end with a period and there are no eyebrow labels above headings.
   - Add periods to "Branches", "Release requests", "Releases" and "Project settings", or agree that product-page headings are exempt and write that into DESIGN.md. **Recommended:** exempt product pages, and remove the periods from "Your projects.", "Account." and the others. Short app headings with periods read oddly next to tables.
   - Remove the "GigaCAD" kicker on auth cards and the lone "GigaCAD" crumb on the dashboard and Explore.
3. **Page widths.** Forms (New project, Settings, Account, Billing, Fork) use one narrow centred column. Everything else is full width. Write this into DESIGN.md so it's a rule, not an accident. Match the billing storage bar to the table width.
4. **Buttons.** Unify `button` (auth and marketing) and `btn` (product) behind one set of tokens, or document when each applies.
5. **Wording.** Pick "Check out" (verb) and "Checked out" (state) and use them everywhere.
6. **Confirm dialogs.** Replace `window.confirm` in `ActionButton`, `UploadFiles` and `EntryMenu` with one small in-app dialog component that says what will be lost.
7. **Mobile.** Check every product page at 390px after the phases above. Known issues: the right-click hint (phase 5.7) and the timeline (phase 1.5).

## Order and size

| Phase | Size | Depends on |
|---|---|---|
| 1. Bugs | Small, about a day | nothing |
| 2. Loading, errors, return path | Medium | nothing |
| 3. Onboarding | Medium | 2.3 for `next` handling |
| 4. Project page structure | Medium | decisions 1, 3, 4 |
| 5. Files, branches, commits | Large | 4.3 for icons |
| 6. Release requests and releases | Large; the zip endpoint is the biggest piece | 1.2, decision 3 |
| 7. Collaboration, account, billing | Medium | decision 5 |
| 8. Polish | Small–medium, ongoing | best done last |

Each phase is its own PR. Each needs `pnpm typecheck`, the unit tests, and the e2e suite (CI's `e2e` job) passing.

## Checking the result

Repeat the audit's walkthrough after each phase, against the local stack. The audit's Playwright scripts (signup to first upload, then the seeded branch and release flow, at 1440px and 390px) should move into the repo as `apps/web/e2e/walkthrough.e2e.ts`. They save screenshots under `test-results/` and fail on any page error, unbranded 404, or horizontal overflow at 390px.

Local stack: `open -a Docker`, then `docker compose up -d s3 && docker compose run --rm s3-setup`, `supabase start`, the API with `node --env-file=.env dist/server.js` in `apps/api`, and `pnpm start` in `apps/web`. The supabase CLI is linked to production, so pass `--local` to every migration command.
