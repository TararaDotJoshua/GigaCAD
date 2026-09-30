# Windows app and SolidWorks plugin framework: what's left

> **Status (2026-09-30):** steps 1–8 are done on the Mac and step 9 (CI on PR #45) is in progress. Delete this file when the PR merges; `docs/WINDOWS_APP_PLAN.md` carries the plan from here.

This is the working plan for PR #45 (branch `windows-plugin-framework`). It records what's done, the decision that changed the design, and every remaining step, in order.

## Context

The request: plan the Windows app, and build a plugin framework that supports SolidWorks only for now.

**First pass (committed, `3dbb01c`):**
- `docs/WINDOWS_APP_PLAN.md` planned a separate .NET 10 WPF tray app with a Cloud Files virtual drive.
- `clients/windows` built a .NET plugin framework (contracts, loader, registry, pipe host, SolidWorks plugin), with 70 tests passing.

**What changed:** while the PR waited, `main` gained **GigaCAD for macOS**, an Electron app in `clients/desktop` (#42–#44). It runs the `giga` CLI in-process and has:
- real folders in `~/GigaCAD`
- `chflags` locks
- Finder Quick Actions over `gigacad://` links
- a menu bar item
- signed over-the-air code bundles

The PR now conflicts with `main`, so CI never ran.

**Decision (2026-09-29):** Windows will be a **port of the Electron app**, not a second codebase. The plugin framework moves into the Electron app in TypeScript. .NET shrinks to the pipe protocol library, which the SolidWorks add-in needs because it must run on .NET Framework 4.8 inside SolidWorks. The Cloud Files virtual drive becomes a later upgrade, as File Provider is on macOS.

## Current state of the branch

- **Merge of `origin/main`:** in progress and **not committed**. Both conflicts are resolved in the working tree:
  - `.github/workflows/ci.yml`: kept main's `desktop` job and this PR's `windows` job.
  - `docs/PLAN.md` architecture tree: `clients/desktop` covers macOS and Windows plus the plugin host. `clients/windows` holds the protocol library and later the add-in.
- **Written, not yet compiled or tested,** in `clients/desktop/src/main/plugins/`:
  - `protocol.ts`: framing (4-byte LE length + UTF-8 JSON, 16 MiB max), `FrameReader`, message and DTO types, `METHODS`, `REQUEST_METHODS`, `ERROR_CODES`, `RpcError`, `ProtocolError`.
  - `pipeName.ts`: `pipeNameFor(domain, user)` (same rules as C# `PipeNames.ForUser`), `currentPipeName()`, and `pipePath()`. The path is `\\.\pipe\<name>` on Windows and `<tmp>/CoreFxPipe_<name>` elsewhere, where .NET's client looks.
  - `types.ts`: `GigaPlugin` (id, name, version, optional `fileTypes`, `ignorePatterns`, `findInstallations`, `commands`/`runCommand`, `addIn`), `CadFileType`, `CadInstallation`, `PluginCommand`, `AddInSession`, `PluginLog`.
  - `registry.ts`: `PluginRegistry`.
    - Refuses bad or duplicate ids.
    - Gives a contested extension to the first plugin by id.
    - Dedupes ignore patterns case-insensitively.
    - Provides `fileTypeFor`, `findInstallations`, `commandsFor`, `runCommand`, and `addInOwner`.
    - Guards every capability call; one that throws is turned off until restart.
    - `status` feeds the Settings plugin list.
  - `pipeServer.ts`: `PluginPipeServer`.
    - Handshake: `host.hello` must come first, and bad requests, protocol mismatches, and unknown clients are refused.
    - Every v1 method answers `not_implemented` until real handlers are registered with `handle()`.
    - Requests run concurrently. `broadcast()`, `sessions`, and `listen()`/`close()` are provided.
    - On Unix the socket is set to `chmod 600` and a stale socket is removed at start.
- **Committed .NET projects,** some of which step 4 removes: Abstractions, Protocol, Host, SolidWorks, TestPlugin, Tests.
- **Environment:** the .NET 10 SDK is installed at `~/.dotnet` and on PATH through `~/.zshrc`.

## Remaining steps

### 1. SolidWorks plugin (TypeScript): `clients/desktop/src/main/plugins/solidworks.ts`
- `createSolidWorksPlugin({ platform, registry })` returns a `GigaPlugin` with:
  - `id: 'solidworks'`, `addIn.clientId: 'solidworks'`.
  - **File types:** `.sldprt` part; `.sldasm` assembly and `.slddrw` drawing, both with references; `.sldlfp`, `.sldblk`, `.slddrt`, and `.sldftp` as other.
  - **Ignore patterns:** the SolidWorks section of `DEFAULT_IGNORE_PATTERNS` in `packages/core/src/ignore.ts` (`~$*`, `*.tmp`, `*.bak`, `Backup of *`, `Backup (*) of *`, `AutoRecover of *`).
  - **`findInstallations()`:**
    - On Windows only, list the subkeys of `HKLM\SOFTWARE\SolidWorks` that match `SOLIDWORKS <year>`, and read `…\<key>\Setup` → `SolidWorks Folder`.
    - Sort newest first, and skip versions with no folder.
    - `addInRegistered` = `HKLM\SOFTWARE\SolidWorks\Addins\{418f9708-1a89-47aa-a633-86bb665d1fad}` exists.
    - Returns `[]` on other platforms.
  - **Add-in hooks:** `onConnected`/`onDisconnected` keep a count of connected SolidWorks windows.
- **Registry access** runs through `reg.exe query <key> /reg:64` via `execFile`, because the app's package check refuses native modules. Export `parseRegSubKeys(output, key)` and `parseRegValue(output, name)` for tests. Exit code 1 means the key is missing.
- Put the add-in GUID in a `SOLIDWORKS_ADDIN_GUID` constant. The future add-in's `[Guid]` must match it.

### 2. Plugin host entry: `clients/desktop/src/main/plugins/index.ts`
- `BUILT_IN_PLUGINS = [createSolidWorksPlugin(...)]`. Plugins are compiled into the signed bundle and never loaded from disk.
- `createPluginHost({ hostVersion, signedInAs, log, platform?, plugins? })` returns `{ registry, server }`, with `server` on `pipePath(currentPipeName())`.
- **Don't wire this into `Controller` yet.** That's milestone W1 of the port, and it keeps the shipping macOS app unchanged. No `SHELL_VERSION` bump is needed, since only `src/main` changes.

### 3. TypeScript tests: `clients/desktop/test/plugins/`
- `protocol.test.ts`:
  - encode/decode round trip, frames split across chunks, several frames in one chunk
  - oversize frames, bad JSON, and non-object frames rejected
  - `null` fields dropped
- `pipeName.test.ts`: sanitizing (`ACME`, `Alex Smith` → `GigaCAD.Host.acme.alex_smith`), the Windows path, and the Unix `CoreFxPipe_` path.
- `registry.test.ts`:
  - combining file types and patterns, first-by-id on conflicts
  - refusing bad and duplicate ids
  - a throwing capability turned off while the rest keep working
  - `findInstallations` asked each time, `commandsFor` limited to the plugin's own kinds, `runCommand` failures, `addInOwner`
- `pipeServer.test.ts`, using a real socket at `pipePath('gc' + random)`:
  - hello accepted, and the plugin's `onConnected`/`onDisconnected` fire
  - every `REQUEST_METHODS` entry answers `not_implemented`
  - unknown methods answer `unknown_method`, and a second hello answers `bad_request`
  - registered handlers run, and `RpcError` codes pass through
  - other exceptions become `internal` without leaking the message
  - `broadcast` reaches clients
  - `unknown_client`, `protocol_version`, and requests before hello are refused and the connection closes
  - garbage frames close the connection
  - no bytes are sent before hello
- `solidworks.test.ts`:
  - file types
  - ignore patterns equal to the SolidWorks section of `ignore.ts`, parsed from the source text so any drift fails
  - `reg.exe` output parsing with sample output
  - installations from a fake registry
  - no installations off Windows
- Then run `pnpm typecheck` and `pnpm test`. Both must be green, including the existing 160+ tests and the desktop tests.

### 4. Slim `clients/windows` to the protocol library
- **Delete:** `src/GigaCAD.Plugins.Abstractions`, `src/GigaCAD.Plugins.Host`, `src/GigaCAD.Plugins.SolidWorks`, `tests/GigaCAD.Plugins.TestPlugin`, and `tests/GigaCAD.Plugins.Tests/{Hosting,SolidWorks}`, plus `Support/TempDirectory.cs` if unused.
- **Keep:** `src/GigaCAD.Plugins.Protocol` (netstandard2.0: framing, `Message`, DTOs, `GigaCadHostClient`, `PipeNames`), and `tests/GigaCAD.Plugins.Tests` with its Protocol tests and `MemoryPipe`/`TaskWaits`/`RepoRoot` support.
- **Tests project:** remove the net10-only conditions, `LayOutPlugins` target, and project references. Keep `net10.0` + `net48` on Windows, and `-p:IncludeNet48=true` for compile checks elsewhere.
- **Net48 compatibility:** the `ConnectingWithNoAppRunningTimesOut` test moves here and uses `Substring`, not ranges.
- **Package versions:** drop `Microsoft.Extensions.Logging.Abstractions` from `Directory.Packages.props`.
- **Solution:** update `GigaCAD.Windows.sln` to list the remaining projects.

### 5. Shared protocol fixtures: `clients/desktop/test/plugins/fixtures/pipe-protocol.json`
- Cases:
  - hello request and result (with and without `signedInAs`)
  - `files.getState` request and result
  - `branch.commitVersion` with no label, so the field is omitted
  - an error response with `details`
  - `candidate.submitRebuildReport` with a full rebuild report
  - a `files.stateChanged` notification
- **TypeScript** (`protocol.test.ts`): the typed messages deep-equal the fixtures, and `FrameReader` reads each fixture's frame.
- **C#** (`Protocol/FixtureTests.cs`, runs on net48 too): read the file with `RepoRoot`, serialize the matching DTOs, and deep-compare with a `JsonElement` comparer, ignoring key order. Also deserialize each fixture and check the fields.

### 6. Real interop test (.NET client ↔ Node server)
- **Console client:** `clients/windows/tests/GigaCAD.Plugins.InteropClient`, targeting `net10.0`, plus `net48` on Windows. It takes a pipe name and prints JSON lines:
  1. the hello result
  2. the `files.getState` result
  3. the `branch.checkout` error code (`not_implemented`)
  4. the next `files.stateChanged`, then exits 0
- **Test:** `clients/desktop/test/plugins/interop.test.ts`, skipped unless `GIGACAD_INTEROP=1`.
  1. Start `PluginPipeServer` with a `files.getState` handler.
  2. Spawn `dotnet run --no-build -f $GIGACAD_INTEROP_TFM --project … -- <pipe>`.
  3. Broadcast after the checkout line.
  4. Assert on every line.
- **Run on the Mac once** with net10.0 over a Unix socket.
- **Add to the `windows` CI job**, after `dotnet test`:
  - `actions/setup-node` (22) and `pnpm/action-setup`
  - `pnpm install --frozen-lockfile` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`
  - `dotnet build` the interop client
  - `GIGACAD_INTEROP=1 GIGACAD_INTEROP_TFM=net48 pnpm vitest run clients/desktop/test/plugins/interop.test.ts`

  This is the real case: a .NET Framework 4.8 client and a Node named pipe on Windows.

### 7. Rewrite `docs/WINDOWS_APP_PLAN.md` as the Electron port
- **Context:** the decision above. One desktop codebase; Windows 10 1709+ and 11, x64.
- **Mapping from `clients/desktop` to Windows:**

  | macOS | Windows |
  |---|---|
  | `~/GigaCAD`, `~/Library/Application Support/GigaCAD` (`shared/runtime.ts`, `settings.ts`) | `%USERPROFILE%\GigaCAD`, `%LOCALAPPDATA%\GigaCAD` |
  | `locks.ts`: `chmod` + `chflags uchg` | Read-only attribute on files (`attrib +R`), and `icacls` deny-write ACE for the user on folders (no add, rename, or delete). Same `lock`/`unlock`/`whileUnlocked` API, chosen by platform. `.giga/` stays writable. |
  | Finder icons (`Icon\r`, `icons.ts`, `iconArt.ts`) | `desktop.ini` folder icons from pre-rendered `.ico` files; file icons later with the shell extension |
  | Quick Actions (`quickActions.ts`, `~/Library/Services`) | HKCU `Software\Classes\Directory\shell\GigaCAD.*` and `*\shell\GigaCAD.*` verbs (a cascading "GigaCAD" submenu) opening `gigacad://action/<action>?path=…` or running `GigaCAD.exe --action`. The same action list, plus plugin commands. |
  | `gigacad://` via `open-url` | Protocol registered by the installer; the URL arrives in `second-instance` argv |
  | Menu bar `Tray` | Notification-area `Tray` (same Electron API, `.ico` image) |
  | `cliInstall.ts` terminal shim | `giga.cmd` in `%LOCALAPPDATA%\GigaCAD\bin`, added to the user PATH |
  | DMG, ad-hoc signed (`electron-builder.yml`) | NSIS per-user installer (`win` target), code-signed through Azure Trusted Signing |
  | OTA bundles (`updates.ts`, `bootstrap/`) | Unchanged: signed bundles from `downloads.gigacad.site/desktop/stable/`, platform-neutral JS; the manifest gains a Windows shell entry |
  | Save watcher (`fs.watch`) | Same, `recursive: true` works on Windows. Keep the 5 s quiet period; SolidWorks writes temp files and renames. |

- **Plugin framework:** the TypeScript host, protocol, and SolidWorks plugin (steps 1–5), with the add-in's side in `clients/windows`.
  - **Pipe:** `\\.\pipe\GigaCAD.Host.<domain>.<user>`, protected by Node's default pipe security. Nothing is sent before a valid hello.
  - **Squatting hardening (before release):** the add-in checks the server process with `GetNamedPipeServerProcessId`.
- **SolidWorks add-in** (`clients/windows/src/GigaCAD.SolidWorks.AddIn`, net48 COM, planned):
  - Registration: GUID `418f9708-1a89-47aa-a633-86bb665d1fad`, `regasm /codebase` plus `HKLM\SOFTWARE\SolidWorks\Addins\{guid}`, done by the installer only when SolidWorks is present.
  - Interop DLLs come from the SolidWorks install (`SOLIDWORKS_INTEROP_DIR`) and are never committed.
  - Features, mapped to pipe methods:
    - Task Pane
    - read-only banner → `files.getState`
    - checkout, checkin, and commit
    - `GetDependencies2` → `files.reportReferences`
    - STL export on version commits → `exports.attach`
    - candidate rebuild → `candidate.submitRebuildReport`
- **The app's method handlers** map pipe methods onto the existing `SyncEngine` and `giga` calls:
  - `getFileState` uses `locate()` + branch state.
  - `checkout`/`checkin`/`commitVersion` use the same `giga` commands as the Quick Actions.
  - `reportReferences` → `PUT /v1/projects/:id/blobs/:sha256/references`
  - `attachExport` → `giga export`
  - `submitRebuildReport` → `giga rr rebuild-report`
  - The `SyncEngine` state change → `broadcast(files.stateChanged)`.
- **Later:** a Cloud Files virtual drive for on-demand files, replacing full downloads, like File Provider on macOS.
- **Milestones:**

  | Milestone | Covers |
  |---|---|
  | W1 | Windows build of `clients/desktop` (paths, tray, `second-instance` URLs, NSIS target, CI `windows` packaging) and wiring the plugin host into `Controller`, with a Settings → Plugins list |
  | W2 | Locks on Windows (attributes and ACLs) with tests on `windows-latest` |
  | W3 | Explorer context menu and folder icons |
  | W4 | Pipe method handlers backed by `SyncEngine` |
  | W5 | SolidWorks add-in: Task Pane, banner, references, pipe server verification |
  | W6 | Exports and candidate rebuild |
  | W7 | Signing, installer polish, download page, OTA shell for Windows |

- **Verification:**
  - Automated: the desktop tests on `windows-latest`, `dotnet test`, and the interop test.
  - Manual, on the Windows laptop with SolidWorks: PLAN.md's checklist, plus the plugin list showing SolidWorks with its version and add-in status, and the add-in connecting and reconnecting.

### 8. Update the other docs
- **`docs/PLAN.md`:**
  - "Windows drive" section: the first version is the Electron port with real folders, linking WINDOWS_APP_PLAN.md; the Cloud Files design stays as the later upgrade.
  - Add-in section path: `clients/windows/src/GigaCAD.SolidWorks.AddIn` (planned).
  - Phase 3 and 4 wording to match.
- **`clients/windows/README.md`:** only the protocol library, its tests, the interop client, and how the add-in uses `GigaCadHostClient`.
- **`clients/desktop/README.md`:** a "Plugins" section: where they live, adding one (implement `GigaPlugin`, add it to `BUILT_IN_PLUGINS`), and the pipe protocol pointer.
- **`docs/NEXT.md`:** Windows is now a port of the desktop app; the plugin framework and protocol are done; next is W1. Required checks now include `windows`.
- **`README.md`:** layout rows for `clients/desktop` (macOS and Windows) and `clients/windows` (protocol library, later the add-in).
- **This file:** delete it, or mark every step done, once the PR merges.

### 9. Ship
1. Commit the merge (conflicts already resolved), then commit the rework in logical commits:
   1. TypeScript plugin framework and tests
   2. .NET slimming, fixtures, and interop
   3. docs
2. Push, and watch PR #45's checks: `check`, `desktop` (macOS, optional), `windows` (the first real run on Windows and .NET Framework 4.8), `api-image`, `integration`, and `e2e`.
3. Fix whatever the Windows run shows, then update the PR description.
4. After merging, the owner adds `windows` as a required check on `main`.

## Verification checklist
- [x] `pnpm typecheck` and `pnpm test` pass (including `clients/desktop/test/plugins/*`)
- [x] `dotnet test clients/windows/GigaCAD.Windows.sln` passes on macOS; the net48 target compiles with `-p:IncludeNet48=true`
- [x] The interop test passes on macOS (net10.0, Unix socket)
- [ ] CI `windows`: `dotnet test` on net10.0 and net48, and the interop test with the net48 client over a real Windows named pipe
- [ ] CI `desktop`: macOS tests and the DMG build still pass, with the shell unchanged
- [x] `scripts/check-secrets.sh` passes
