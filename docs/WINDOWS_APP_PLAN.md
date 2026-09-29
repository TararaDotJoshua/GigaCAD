# GigaCAD for Windows

## Context
Phases 3 and 4 of [PLAN.md](PLAN.md) come next: the Windows drive and the SolidWorks add-in. This doc plans the whole Windows app. The download page (`apps/web/app/(marketing)/download/page.tsx`) already promises what it does: one installer sets up the GigaCAD drive in File Explorer, a tray app for signing in and committing, and the SolidWorks add-in. It supports Windows 10 1709+ and 11, 64-bit only.

CAD-specific behavior lives in **plugins**, so the drive, tray, and Explorer menu stay CAD-agnostic. SolidWorks is the only plugin for now; Fusion, FreeCAD, and others come later (PLAN.md phase 7). The plugin framework is built and tested in `clients/windows` (see [its README](../clients/windows/README.md)). Everything else here is still a plan.

## Components

```
clients/windows/
  src/
    GigaCAD.Plugins.Abstractions/   built   netstandard2.0  contracts plugins implement
    GigaCAD.Plugins.Protocol/       built   netstandard2.0  add-in ↔ app pipe messages and client
    GigaCAD.Plugins.Host/           built   net10.0         plugin loader, registry, pipe server
    GigaCAD.Plugins.SolidWorks/     built   net10.0         the SolidWorks plugin (inside the app)
    GigaCAD.Api/                    planned net10.0         C# port of the CLI's API client and transfers
    GigaCAD.Sync/                   planned net10.0-windows Cloud Files sync engine, local state
    GigaCAD.App/                    planned net10.0-windows GigaCAD.exe: tray app hosting everything above
    GigaCAD.Shell/                  planned net10.0-windows Explorer context menu (IExplorerCommand)
    GigaCAD.SolidWorks.AddIn/       planned net48           COM add-in loaded by SolidWorks
  installer/                        planned                 WiX v5 MSI + sparse package
```

.NET 10 is the LTS release (supported to November 2028). The SolidWorks add-in runs inside SolidWorks' process, which hosts .NET Framework 4.8, so everything the add-in uses targets `netstandard2.0`.

## Processes
Everything runs **per user**. A Cloud Files sync root belongs to the signed-in user, and a Windows service can't own one.

| Process | What |
|---|---|
| `GigaCAD.exe` | The tray app. It hosts the sync engine, the plugin host, and the add-in pipe. It starts at sign-in (HKCU `Run` key) and allows one instance per user (named mutex). |
| `GigaCAD.Shell.dll` | Explorer context menu handlers. It runs inside `explorer.exe` and forwards every command to `GigaCAD.exe` over the pipe. |
| `GigaCAD.SolidWorks.AddIn.dll` | Runs inside `SLDWORKS.exe` and connects to `GigaCAD.exe` over the pipe. |

Keeping the network, sync state, and credentials in `GigaCAD.exe` means the shell extension and the add-in hold no tokens and never talk to the API directly.

## Plugins

A plugin has two halves:

1. **Host plugin**, loaded into `GigaCAD.exe` from `%ProgramFiles%\GigaCAD\plugins\<id>\` (`plugin.json` + dll). It implements `IGigaPlugin` plus any of these capabilities:
   - `IFileTypeProvider`: file extensions, display names, and kinds (part, assembly, drawing), and whether they reference other files. These drive the icons, the drive's "open with" hints, and which files get reference and export extras.
   - `IIgnoreRuleProvider`: temp, lock, and backup files the CAD program writes. The save pipeline skips them.
   - `ICadInstallationLocator`: installed versions, and whether the add-in is registered. Shown in the tray's plugin list.
   - `ICommandProvider`: extra Explorer and tray commands, for example "Open in SolidWorks".
   - `IAddInConnectionHandler`: hears when its CAD add-in connects or disconnects.
2. **CAD add-in**, running inside the CAD program. It speaks the pipe protocol through `GigaCadHostClient` from `GigaCAD.Plugins.Protocol`. Its `host.hello` names a `clientId`, and the app routes the session to the plugin with that `AddInClientId`.

Rules:
- **Loading:** each plugin gets its own `AssemblyLoadContext`, and the contracts assembly is shared from the app. A plugin that fails to load, or whose `hostApi` doesn't match, is shown as failed in the tray, and the other plugins still load. A capability that throws is turned off for that plugin until the app restarts.
- **Trusted plugins only:** only first-party plugins, installed with the MSI into `Program Files`, which only administrators can write. Debug builds also read `GIGACAD_PLUGIN_DIRS`. Third-party plugins would need code signing checks and are out of scope.
- **Extension conflicts:** when two plugins claim the same extension, the first by id wins and a warning is logged.
- **Adding a plugin (e.g. Fusion):**
  1. Add a `GigaCAD.Plugins.Fusion` host plugin and a `plugin.json`.
  2. Add the add-in in whatever runtime the CAD program hosts. It either references `GigaCAD.Plugins.Protocol` or reimplements the framing, which is 4-byte length + JSON.
  3. Add both to the installer.

  The drive, tray, and API need no changes.

### Pipe protocol (v1)
- **Pipe:** `\\.\pipe\GigaCAD.Host.<domain>.<user>`, created with `PipeOptions.CurrentUserOnly`, so only the same user can connect.
- **Framing:** a 4-byte little-endian length, then UTF-8 JSON (16 MiB max).
- **Messages:** shaped like JSON-RPC 2.0. Errors use the API's `{ code, message, details }`, and API error codes such as `checked_out` and `stale_head` pass through unchanged.

| Method | Direction | Purpose |
|---|---|---|
| `host.hello` | add-in → app | Must be first. Carries the client id and version, protocol version, CAD name and version, and process id. Refused with `protocol_version` or `unknown_client`. |
| `files.getState` | add-in → app | For each path: is it in the drive, which project and branch, is it writable, and who holds the checkout. Drives the read-only banner. |
| `branch.checkout` / `branch.checkin` | add-in → app | Check a branch out or in, from any path inside it |
| `branch.commitVersion` | add-in → app | Commit a version with a message and optional label |
| `files.reportReferences` | add-in → app | A file's references from `GetDependencies2` → `PUT /v1/projects/:id/blobs/:sha256/references` |
| `exports.attach` | add-in → app | Upload a STEP or STL export → `PUT /v1/projects/:id/exports` |
| `candidate.submitRebuildReport` | add-in → app | → `POST /v1/release-requests/:id/rebuild-report` |
| `files.stateChanged` | app → add-in | Notification: these paths changed state (checkout, new commit, new release) |

Today every method except `host.hello` answers `not_implemented`. The sync engine registers real handlers on `PluginHost.Dispatcher` as each milestone lands.

**Hardening before release:** the add-in should check that the pipe's server process is `GigaCAD.exe` signed by us (`GetNamedPipeServerProcessId`), so another program can't squat the pipe name first.

## API client and sign-in
- `GigaCAD.Api` ports `clients/cli/src/api.ts` (JSON client, error codes) and `transfer.ts` (presigned batches of 200, 4 concurrent transfers, SHA-256 checks before anything is put in place).
- **Sign-in:** device flow, as `giga login` does. `POST /v1/auth/device/code` sends `clientName = "GigaCAD for Windows on <computer>"`. The tray shows the code and opens `app.gigacad.site/device`, then polls `/v1/auth/device/token`.
- **Token storage:** DPAPI (`ProtectedData`, CurrentUser) in `%LOCALAPPDATA%\GigaCAD\credentials.bin`, kept separately for each API URL so local and production never mix.
- **Checkout locks** use `Environment.MachineName` as the machine.
- **Sign-out** revokes the token (`DELETE /v1/me/tokens/:id`) and removes the local copy.

## Sync engine (`GigaCAD.Sync`)
- **Sync root:** registered with the Cloud Files API (CsWin32 bindings), named **GigaCAD**, and shown in the Explorer sidebar. It lives at `%USERPROFILE%\GigaCAD`.
- **Layout:** `GigaCAD\<owner>\<project>\` with `main\` and `releases\vN\` (read-only), `branches\<name>\` (writable only while you hold the checkout), and `candidates\RR-<n>\`. Every branch or candidate folder holds the whole project tree, so SolidWorks' relative references resolve.
- **Placeholders:** created from manifests. Opening a file hydrates it through `blobs/downloads`, checked against its SHA-256. Checking out a branch hydrates the whole branch and pins it, so SolidWorks can resolve every reference offline.
- **Read-only enforcement:** folders you can't write get read-only placeholders. On branches you don't hold, writes are refused in the sync callbacks, and the overlay shows "checked out by @alex".
- **Save pipeline:**
  1. A file handle closes on a checked-out branch.
  2. Skip it if it matches the ignore rules. The rules are the generic defaults (a port of `packages/core/src/ignore.ts`), the plugin registry's patterns, and `.gigaignore`.
  3. Wait out a 5 s debounce. SolidWorks saves by writing a temp file and renaming it, so the debounce waits for the rename.
  4. Hash, upload the missing blobs, and post an autosave commit.
  5. On `stale_head`: pull, then retry once. If it fails again, show an error in the tray.
- **Local state:** SQLite at `%LOCALAPPDATA%\GigaCAD\state.db`. It holds each file's item ID, blob hash, and sync state, plus each project's events cursor and the offline upload queue.
- **Live state:** polls `GET /v1/projects/:id/events?after=` for subscribed projects, every 15 s while the tray window is open and every 60 s otherwise. Supabase Realtime comes later. Changes update placeholders and are broadcast to add-ins as `files.stateChanged`.
- **Offline:** a checked-out branch keeps working. Autosaves queue and upload on reconnect, in order.

## Explorer integration (`GigaCAD.Shell`)
- **Context menu:** `IExplorerCommand` handlers, registered through a sparse MSIX package so they appear in the Windows 11 top-level menu. The items are:
  - Check Out / Check In
  - Commit Version…
  - New Branch…
  - Open Release Request
  - History
  - Open on gigacad.site
  - plus plugin commands from `PluginRegistry.CommandsFor`
- **State overlays:** synced, uploading, read-only, and checked out by someone else. They use Cloud Files states and custom state icons.

## Tray app (`GigaCAD.App`)
WPF with H.NotifyIcon. Windows:
- **Sign in:** shows the code and a button that opens the device page.
- **Status:** sync progress, errors with the same hints as the CLI's recovery table, and recent activity.
- **Commit Version:** message and label, and the list of changed files.
- **Settings:** API URL (development builds only), start at sign-in, and the **Plugins** list. For each plugin it shows state (loaded, failed with reason, or disabled), the detected CAD versions, whether the add-in is registered, and whether the add-in is connected now. A toggle disables a plugin.

## SolidWorks add-in (`GigaCAD.SolidWorks.AddIn`)
- **Registration:** a .NET Framework 4.8 COM class with `ISwAddin`, using the GUID `SolidWorksIds.AddInGuid` (`418f9708-1a89-47aa-a633-86bb665d1fad`). The installer registers it with `regasm /codebase` and `HKLM\SOFTWARE\SolidWorks\Addins\{guid}`.
- **Interop DLLs** come from the SolidWorks install at build time (`SOLIDWORKS_INTEROP_DIR`) and are never committed, so CI builds everything except this project.
- **Connection:** on `ConnectToSW` it connects with `GigaCadHostClient` (`clientId: "solidworks"`). If the app isn't running it retries in the background, and the Task Pane says GigaCAD isn't running.
- **Task Pane:** the project, branch, and checkout holder for the active document; Check Out / Check In, Commit Version, and Open Release Request; the Rebuild candidate button on candidate folders.
- **On open:** calls `files.getState`. If the file isn't writable, it opens read-only with a banner saying "Checked out by @alex".
- **On version commit:**
  1. Send each assembly's and drawing's `GetDependencies2` → `files.reportReferences`.
  2. Export a coarse STL of each changed part and assembly with `SaveAs3` → `exports.attach`.
  3. Autosaves don't export.
- **Rebuild candidate** (PLAN.md rule 7):
  1. Open each top-level assembly.
  2. Repoint replaced items with `ReplaceReferencedDocument`.
  3. Run `ForceRebuild3`.
  4. Collect rebuild and mate errors.
  5. Export STEP AP242 and a fine STL.
  6. Save → `candidate.submitRebuildReport`.

## Installer and updates
- **MSI:** WiX v5, per-machine, into `%ProgramFiles%\GigaCAD`. It includes `plugins\solidworks\`, the add-in registration (only when SolidWorks is installed), and the sparse package for the shell extension.
- **Code signing:** Azure Trusted Signing, for the MSI, every exe and dll, and the sparse package, which must be signed.
- **Updates:** the app checks a JSON feed on gigacad.site (version, MSI URL, SHA-256) daily and offers the update from the tray. The download page's `DOWNLOAD_URL` points at the latest MSI.

## Milestones
| # | Milestone | Done when |
|---|---|---|
| — | Plugin framework | **Built.** Contracts, loader, registry, pipe protocol, and SolidWorks host plugin, tested in CI on Windows (.NET 10 and .NET Framework 4.8) |
| W1 | Tray and sign-in | Device sign-in, token in DPAPI, plugin list in Settings |
| W2 | Read-only drive | Sync root, `main\` and `releases\vN\` placeholders that hydrate on open |
| W3 | Checkout and saves | Checkout hydrates and pins, save pipeline makes autosaves, read-only enforcement, `files.getState` and checkout methods implemented |
| W4 | Explorer | Context menu, overlays, commit dialog |
| W5 | Add-in basics | Task Pane, read-only banner, references, pipe server verification |
| W6 | Exports and rebuild | STL on version commits, candidate rebuild with STEP and STL |
| W7 | Ship | Installer, signing, update feed, download page live |

## Verification
- **Automated:** `pnpm test:windows` (or `dotnet test clients/windows/GigaCAD.Windows.sln`) locally, and the `windows` CI job on every pull request. Each milestone adds tests for its own layer. The API client runs against the local stack in `integration`, and the sync engine is tested against a temporary sync root on `windows-latest`.
- **Manual, on the Windows laptop with SolidWorks:** the checklist in PLAN.md's Verification section, plus:
  1. The tray's plugin list shows SolidWorks loaded, with the installed version and the add-in registered.
  2. Opening SolidWorks shows the add-in connected in the tray.
  3. Quitting the app while SolidWorks is open shows "GigaCAD isn't running" in the Task Pane, and the add-in reconnects when the app starts again.
