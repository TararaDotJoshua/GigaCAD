# Desktop app UX fixes: plan

This plan covers the findings from the 2026-10-07 audit of the desktop app's window (`clients/desktop`). The audit was a code read of the renderer and the main process, then a visual pass. For the visual pass, the window ran in a browser with a fake preload bridge and sample projects, as macOS and as Windows, at the default 1120×740 window and at the 860×560 minimum. Paths are relative to `clients/desktop/src/` unless they start with `docs/` or `apps/`.

macOS and Windows run the same Electron app, so every item applies to both. Where the two systems need different code, the item says how.

Status (2026-10-08): decisions approved; nothing is built yet.

## Decisions (approved 2026-10-08)

The owner chose these on 2026-10-08.

1. **How to confirm actions that lose something.** The web app asks in place: one sentence, and the same button pressed again (docs/design/README.md, "Confirming").
   - **Decided:** use the same in-place confirm in the desktop window, so both apps behave alike. Keep native dialogs (`dialog.showMessageBox`) only for messages that appear while the window is hidden, as Quick Actions do today.
2. **Where activity lives.** The sync engine keeps a list of 50 events (`main/sync.ts:82`), including conflicts, but the window never shows it.
   - **Decided:** an Activity tab on branch pages, plus a popover from the sync status that lists everything, marked when there are unread errors. Show conflicts as a notice at the top of the branch they belong to.
3. **Root files in the window.** Today root files appear only in Finder or File Explorer, and on the web.
   - **Decided:** a Root files tab on the project page listing recent revisions, each with Show and Open on gigacad.site. No editing in the window.
4. **Approving release requests in the app.** Approve is one click in the window today, but choosing what goes into the release happens only on the web.
   - **Decided:** keep Approve in the app behind the in-place confirm, and add a "Needs you" panel on the project page. Review still opens the web.
5. **Keyboard shortcuts.** Mod is ⌘ on macOS and Ctrl on Windows.
   - **Decided:**

     | Shortcut | Does |
     |---|---|
     | Mod+Enter | Commit Version |
     | Mod+, | Settings |
     | Mod+R, or F5 on Windows | Refresh the current view and sync now |
     | Mod+1 to Mod+9 | Projects in sidebar order |
     | Mod+F | Filter projects |
     | Mod+[ and Mod+] | Back and forward |
     | Mod+Shift+O | Open on gigacad.site |
     | Mod+Shift+R | Show in Finder / File Explorer |
     | Mod+Plus, Mod+Minus, Mod+0 | Zoom |

## Phase 1: layout breakage (small, ship first)

At 860×560, the smallest window the app allows, these all go wrong at once.

| # | Bug | Fix | Files |
|---|---|---|---|
| 1.1 | The toolbar title shrinks to "M." (15 px wide) because the toolbar buttons never shrink. "Synced 3 min ago" wraps onto three lines, and the toolbar grows to 75 px tall. | Let the title shrink first: `flex: 1 1 auto; min-width: 120px` on the title, `white-space: nowrap` on the sync status. When there isn't room, move secondary buttons into a ⋯ menu (phase 2). | `renderer/components/Toolbar.tsx`, `renderer/styles.css` |
| 1.2 | On Windows, the caption-button strip is fixed at 52 px (`titleBarOverlay.height`), so it stops lining up when the toolbar grows. | Fix the toolbar at 52 px on every system: one row, never wrapping. After 1.1 it never needs more. | `main/controller.ts:227`, `renderer/styles.css` |
| 1.3 | `.split` always gives the right column 320 px, leaving the left column 216 px at the minimum size. "wheel-hub" disappears entirely (0 px wide), "gripper" shows as "grip", release notes get 3 px, and "13 d ago" wraps. | Make `.main` a container (`container-type: inline-size`) and stack `.split` into one column below 900 px. Phases 4 and 5 remove most two-column layouts anyway. | `renderer/styles.css` |
| 1.4 | The update banner takes about 150 px of a 560 px tall sidebar. | Below 640 px of window height, collapse it to one line ("Update ready · Restart") with the notes in a popover. | `renderer/components/UpdateBanner.tsx`, `renderer/styles.css` |
| 1.5 | Branch and release rows are 36 or 43 px tall depending on whether they have a button. | Set a fixed `min-height` on `.rows > li`. Action buttons shouldn't change the row's height. | `renderer/styles.css` |
| 1.6 | After "Stop syncing this project", the main view keeps showing the project, because `renderMain` also finds hidden projects. It even still offers "Stop syncing", and nothing there turns syncing back on. | When the selected project is hidden, show "Not synced to this Mac" with a Sync again button. | `renderer/App.tsx:67`, `renderer/components/ProjectView.tsx` |

**Tests:** a renderer test that a hidden project's view offers Sync again. The layout checks are in "Checking the result" below.

## Phase 2: the toolbar and headings

1. **A breadcrumb instead of the label above the title.** Today the toolbar shows a small label above the title: the owner on project pages ("josh"), the owner and slug on branch pages ("josh/rover"), and "GigaCAD" above Settings. The design system forbids labels above headings, and calls out the "GigaCAD" one by name. Replace them with one clickable line: `josh / Mars Rover Chassis` on project pages, `Mars Rover Chassis / suspension-v3` on branch pages, and plain `Settings`.
2. **State next to the title.** Your checkout is shown only by a 7 px green dot in the sidebar. Put a chip next to the branch title:
   - "Checked out" with a Signal dot for you
   - "🔒 @sam" for someone else
   - "Frozen · request #7"
   - "View only"
3. **One main action per view.**
   - Project pages: New Branch.
   - Branch pages:
     - Check Out, when nobody holds the branch.
     - Download, when it isn't downloaded and you can't check it out.
     - Check In, when you hold it. Check In stays secondary, because committing is the main work.
   - Everything else becomes an icon button with a tooltip and a shortcut: Pull, Show in Finder / File Explorer, Open on gigacad.site.
   - A ⋯ menu holds the rest: Copy link, Open in Terminal, Remove download, and Stop syncing this project.

   Today a branch that isn't downloaded shows two filled main buttons at once (Check Out and Download).
4. **Sync status as a button.**
   - When synced, a click syncs now.
   - With a problem or offline, the click opens the Activity popover with the error, instead of the error being a hover-only `title`.
   - While syncing, it shows how many tasks are running.

   The `syncNow` command already exists, and only the tray uses it today.
5. **Pending labels on actions.** While an action runs, its button says what's happening: "Checking out…", "Pulling…", "Downloading…". It stays disabled until `branch.busy` clears, and then a short toast confirms the result ("Checked out suspension-v3"). Today `act()` only shows a toast when something fails (`renderer/api.ts:67`).

Files: `renderer/components/Toolbar.tsx`, `BranchView.tsx`, `ProjectView.tsx`, `Settings.tsx`, `renderer/api.ts`, `renderer/styles.css`.

## Phase 3: seeing what happened

1. **Activity** (decision 2). Show `state.activity` in the window. Each entry gets its time, its project and branch, and a link to the thing it's about. Unread errors mark the sync status and the Activity tab. The tray keeps its three most recent lines.
2. **Conflicts.** `main/sync.ts:302` logs "X changed here and on gigacad.site. Your version is Y." Also add the conflict to the branch's state (a `conflicts` list on `BranchState`). Show it as a caution notice at the top of that branch's Changes tab with "Show both", and a caution dot on the branch in the sidebar until it's dismissed.
3. **Toasts.**
   - Add a × button.
   - Pause the timer while the pointer is over a toast.
   - Add "Copy error" on error toasts.
   - Make toasts reachable with Tab and closable with Escape.

   Today error toasts disappear after 9 seconds, taking giga's hint with them.
4. **Setup failures.** A failed Repair step shows only at the bottom of Settings, below the fold. Also show a notice at the top of Settings, and a dot on the sidebar's gear icon.

Files: `shared/types.ts`, `main/sync.ts`, `main/controller.ts`, `renderer/components/Toasts.tsx`, a new `renderer/components/Activity.tsx`, `renderer/api.ts`, `Settings.tsx`, `Sidebar.tsx`.

## Phase 4: project page structure

1. **Tabs with counts:** Branches, Releases, Release requests, and Root files (decision 3).
   - Show a count on each tab.
   - Release requests uses a caution-colored count when a request is waiting for your approval.
2. **Branches as a table.** Columns: Branch, State, On this Mac, and an action.
   - State is "Checked out by you" with a Signal dot, "🔒 @sam · Sam's PC", "Frozen · request #7", or "Available".
   - The action is Open for downloaded branches and Download for the rest. Remove download moves to the right-click and ⋯ menus.
   - Clicking anywhere on a row opens the branch.
3. **New Branch as a sheet.** The always-open form in the right column becomes a toolbar button that opens a small sheet with Name and "Start from". Check the name as you type with the path rules in `packages/core`, so mistakes show before you submit.
4. **Releases tab.** Each release has its number, its name (the release request's title, as on the web; `ReleaseState` needs that title added), its notes, and whether it's on this computer. Actions: Show for downloaded releases, Download for the rest. "Keep on this Mac" moves into the tab's header. The Branches tab shows only the latest release, in a small panel. Today every release row has its own "Download" button.
5. **"Needs you" panel** (decision 4). Release requests waiting for your approval appear on the Branches tab, with Review and Approve. Approve uses the in-place confirm.
6. **Refreshing release requests.** Reload when the window gets focus and when the project's head changes, as the Changes tab already does. Today they load once per project (`ProjectView.tsx:196`).
7. **Stop syncing this project** moves to the ⋯ menu and the right-click menu. It's a rare action, and today it has its own panel.
8. **Empty states.**
   - "No projects yet" gets a Create a project button that opens gigacad.site/new.
   - "No branches yet" gets a New Branch button for people who can edit.

Files: `renderer/components/ProjectView.tsx` (split into `BranchesTab`, `ReleasesTab`, `RequestsTab`, `RootFilesTab`), `NewBranchSheet.tsx`, `App.tsx`, `renderer/styles.css`. Root files may need a new main-process command to list recent revisions.

## Phase 5: branch page

1. **Changes list.**
   - Replace the variable-width badges with a fixed one-letter column: M for modified (caution), A for added (Signal), D for deleted (danger), R for moved (muted). File names then start in the same place on every row.
   - Show the folder dimmed and the file name bright, and moves as `new/path ← old/path`.
   - Clicking a row shows the file in Finder or File Explorer, and double-clicking opens it.
   - Right-click gives Show, Open, Copy path, and Open on gigacad.site.
2. **Commit box under the list.**
   - Dock the Message and Label fields under the changes list, so the page is one column at any width.
   - Mod+Enter commits.
   - The button says how many changes it records ("Commit Version · 5 changes").
3. **Before you check out.** When you don't hold the branch, the commit box is replaced by one line: "Check out suspension-v3 to commit versions from this Mac", with the Check Out button. Today the form is shown greyed out.
4. **History without downloading.** History comes from the API, so show it for branches that aren't downloaded. Only the Changes tab needs the "isn't downloaded" panel.
5. **History as a timeline.**
   - Versions get solid dots and autosave groups get dashed hollow dots, the drawing convention for hidden edges.
   - Autosave groups get an arrow that shows they expand.
   - The version label shows as a badge, and the message as the main text.
   - Each entry gets Open on gigacad.site and Copy link.
   - Relative times update every 30 seconds, reusing `SyncStatus`'s timer.
6. **Branches that aren't downloaded in the sidebar.** While one is open, show it in the sidebar under its project (dimmed, not downloaded), so the sidebar always highlights where you are.

Files: `renderer/components/BranchView.tsx` (split into `Changes`, `CommitBox`, `History`), `renderer/history.ts`, `Sidebar.tsx`, `renderer/styles.css`.

## Phase 6: navigation, keyboard, and menus

1. **Shortcuts** (decision 5).
   - Handle them in the window, so macOS and Windows get the same set.
   - On macOS, also list them in a View menu and a Go menu, so they show in the menu bar.
   - On Windows the app menu stays off (`main/controller.ts:335`).
   - Zoom: today neither system can zoom. Add `webContents.setZoomLevel` behind a `zoom` command, and save the level in settings.
2. **Right-click menus** on project, branch, release, history and changed-file rows.
   - Build them in the main process with `Menu.popup`, so they look native on both systems.
   - Entries:
     - Show in Finder / File Explorer
     - Open on gigacad.site
     - Copy link
     - Open in Terminal
     - Check Out or Check In
     - Download or Remove download
     - Stop syncing
   - The `openTerminal` and `webUrl` commands already exist, and the window never uses them.
3. **Remembering where you were.**
   - Save the selected project, branch and tab in `localStorage`, and restore them when the window opens.
   - Save the window's size, position and maximized state in settings, and restore them, checking they're still on a connected screen.
   - Keep a back and forward history for Mod+[ and Mod+].
4. **Sidebar.**
   - A filter box at the top (Mod+F).
   - Owner groups that can collapse, with the state saved.
   - A spinner on a branch while it's busy.
   - A caution dot for conflicts.
   - The gear icon highlighted while Settings is open.
   - The project's error dot gets an accessible label and opens the error on click.
5. **Tabs.**
   - Arrow keys move between tabs.
   - Each tab gets `aria-controls`, and its panel gets `role="tabpanel"`.

Files: `main/controller.ts` (menus, zoom, window bounds, context-menu command), `shared/types.ts`, `preload/index.ts`, `renderer/App.tsx`, `Sidebar.tsx`, a new `renderer/shortcuts.ts`, `renderer/styles.css`.

## Phase 7: confirming

Use the in-place confirm from decision 1 for:

| Action | Sentence |
|---|---|
| Approve | "Approve #7? The release goes out when the last approval is in." |
| Open release request | "This freezes suspension-v3 until the request is released or closed." |
| Remove download | "Removes the local copy of wheel-hub. Nothing on gigacad.site changes." |
| Stop syncing | "GigaCAD stops updating this project's folder. The folder stays where it is." |
| Sign Out | "Syncing stops until you sign in again. The giga command line tool is signed out too." |
| Check In with changes that aren't autosaved yet | "2 saves haven't been autosaved yet. Check in anyway?" Only if the engine can tell. |

Build one `ConfirmButton` component in the renderer that matches the web's `ActionButton` `confirm` behavior.

Files: a new `renderer/components/ConfirmButton.tsx`, and every view above.

## Phase 8: notifications and the tray

1. **More system notifications while the window is hidden:**
   - a conflict
   - a release request waiting for your approval
   - someone else checking out a branch you have downloaded
   - a sync problem that lasts more than 5 minutes

   Clicking one opens the window at that place. Add an option in Settings to turn each kind off.
2. **A count of things that need you.** Conflicts, approvals, and failed setup steps add up to one count:
   - On macOS, show it with `app.setBadgeCount` on the Dock icon.
   - On Windows, show it with `BrowserWindow.setOverlayIcon` on the taskbar button.
3. **Tray icon and tooltip.**
   - Swap the tray icon for syncing, problem and paused states: template images on macOS, colored ones on Windows.
   - Put the status in the tooltip ("GigaCAD · Synced 3 min ago").
   - Add the five most recently used projects to the tray menu.

   Today the icon and tooltip never change.
4. **Pause durations.** Pause syncing offers "For 1 hour", "Until tomorrow", and "Until I resume", in Settings and in the tray. Save the end time in settings and resume on time.

Files: `main/controller.ts`, `main/settings.ts`, `shared/types.ts`, `renderer/components/Settings.tsx`, tray icons rendered by `scripts/icons.mjs`.

## Phase 9: Settings and polish

1. **Settings layout.**
   - One narrow column (about 640 px) in sections, with labels on the left and controls on the right.
   - Styled checkboxes, or switches, instead of the browser's plain grey ones.
   - Repair goes in its own section, collapsed when everything passed.
2. **Words.**
   - Use "Check out" (verb) and "Checked out" (state) everywhere.
   - "Show" on a release becomes "Show in Finder" / "Show in File Explorer".
   - The Releases panel's tag icon becomes the padlock, as on the web.
3. **Loading.**
   - Replace the blank `app-loading` screen and the "Loading…" text with skeleton rows shaped like the lists they stand in for.
4. **Contrast.** `--paper-faint` is used for 12 px text (`.field-note`, `.nav-note`, `.sync-status`), but the design system allows it only at 14 px and larger. Use `--paper-muted` for those, or make them bigger.

Files: `renderer/components/Settings.tsx`, `Setup.tsx`, `ProjectView.tsx`, `renderer/styles.css`.

## Order and size

| Phase | Size | Depends on |
|---|---|---|
| 1. Layout breakage | Small, about a day | nothing |
| 2. Toolbar and headings | Small–medium | 1 |
| 3. Seeing what happened | Medium; conflicts need a sync engine change | decision 2 |
| 4. Project page structure | Medium–large | 2, decisions 3 and 4 |
| 5. Branch page | Medium | 2 |
| 6. Navigation, keyboard, menus | Medium | decision 5; 4 and 5 for the rows menus attach to |
| 7. Confirming | Small | decision 1 |
| 8. Notifications and tray | Medium | 3 for the count; icons need `pnpm icons` on a Mac |
| 9. Settings and polish | Small–medium, ongoing | best done last |

Each phase is its own PR. Phases 1, 2, 5 and 7 change only the code bundle, so they reach installed apps as over-the-air updates. Any phase that changes `src/bootstrap/` or the Electron version needs a `SHELL_VERSION` bump and a new DMG and installer (see `clients/desktop/README.md`). None of the phases above should need that. Each PR needs `pnpm typecheck`, `pnpm test`, and the `desktop` and `windows` CI jobs passing.

## Checking the result

The audit ran the renderer in a browser through Vite with a fake `window.gigacad` bridge and sample state. Keep that setup in the repo as a development tool:

- `src/renderer/preview/` holds the fake bridge and fixtures for each view and state:
  - signed out, first run
  - project, branch held by you, held by someone else, not downloaded
  - history, release requests
  - settings with a failed step
  - sync problem, update ready, conflict
- `?platform=win32` switches to Windows.
- `pnpm --filter @gigacad/desktop preview` serves it on port 5179. It's excluded from the bundle build.
- A Playwright script (`clients/desktop/test/layout.e2e.ts`) screenshots every fixture on both systems at 1120×740 and 860×560. It fails on:
  - horizontal overflow
  - toolbar titles narrower than 120 px
  - toolbars taller than 52 px
  - any console error

After each phase, look through those screenshots, and try the real app with `pnpm --filter @gigacad/desktop dev` on macOS. On Windows, test with the CI installer, as [the Windows PC runbook](../clients/windows-pc-runbook.md) describes.
