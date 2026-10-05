# GigaCAD for Windows

## Context
Phases 3 and 4 of [the product plan](../product/plan.md) come next: the Windows app and the SolidWorks add-in. SolidWorks only runs on Windows, so this is where GigaCAD's CAD features land.

GigaCAD for macOS (`clients/desktop`) is an Electron app. It:
- runs the `giga` CLI in-process
- keeps projects as real folders in `~/GigaCAD`
- locks branches you don't hold and releases
- turns saves into autosaves
- adds right-click Quick Actions
- updates its code over the air

**Windows is a port of that app, not a second codebase.** One desktop app ships on both systems. The virtual drive from the original plan (Cloud Files API, on-demand files) becomes a later upgrade, as File Provider is on macOS.

CAD-specific behavior lives in **plugins**, so the app stays CAD-agnostic. SolidWorks is the only plugin for now. The plugin framework is built and tested (see [Plugins](#plugins)); everything else here is a plan.

The download page (`apps/web/app/(marketing)/download/page.tsx`) promises Windows 10 or 11, 64-bit.

## Where the code lives

```
clients/desktop/                   the app, for macOS and Windows (TypeScript, Electron)
  src/main/plugins/                built    plugin registry, add-in pipe server, SolidWorks plugin
  src/main/…                       ported   sync engine, locks, icons, context menu, updates, tray
clients/windows/                   .NET
  src/GigaCAD.Plugins.Protocol/    built    netstandard2.0: the add-in side of the pipe protocol
  src/GigaCAD.SolidWorks.AddIn/    planned  .NET Framework 4.8 COM add-in loaded by SolidWorks
  tests/                           built    protocol tests (.NET 10 + 4.8), interop client
```

## Porting `clients/desktop`

Most of the app is platform-neutral: the sync engine (`sync.ts`), sign-in, the CLI calls, the window (React), and the signed update bundles. These pieces change:

| macOS | Windows |
|---|---|
| `~/GigaCAD`, and support files in `~/Library/Application Support/GigaCAD` (`settings.ts`, `shared/runtime.ts`) | `%USERPROFILE%\GigaCAD`, and `%LOCALAPPDATA%\GigaCAD` |
| **Locks** (`locks.ts`): files `chmod 444` + `chflags uchg`, folders `chmod 555` | Files get the read-only attribute. Folders get an `icacls` deny ACE for the user covering write, append, and delete-child, so nothing can be added, renamed, or deleted. `.giga\` stays writable. Same `lock`/`unlock`/`isLocked`/`whileUnlocked` API, chosen by platform. |
| **Finder icons** (`icons.ts`, `iconArt.ts`, the `Icon\r` file) | `desktop.ini` + `.ico` folder icons, set with the folder's system attribute. The `.ico` files are pre-rendered on a Mac in `pnpm icons`, as the PNGs are today. `desktop.ini` joins the lock walker's exceptions, as `Icon\r` is now. |
| **Quick Actions** (`quickActions.ts`, `~/Library/Services`) | A cascading **GigaCAD** submenu on files and folders, under HKCU `Software\Classes\*\shell` and `Directory\shell`. Each verb runs `GigaCAD.exe --action <action> "%1"`. Same action list, plus plugin commands from `PluginRegistry.commandsFor`. Windows 11 shows it under "Show more options"; a sparse-package `IExplorerCommand` for the top-level menu is a later upgrade. |
| `gigacad://` links through `open-url` (`index.ts`) | `app.setAsDefaultProtocolClient`. The link and `--action` arrive in `second-instance` argv, which the single-instance lock already routes. |
| **Menu bar item** (`Tray`, template image) | Notification-area `Tray` with an `.ico`. Same menu. |
| **Terminal `giga`** (`cliInstall.ts`: a `/usr/local/bin/giga` shim running `ELECTRON_RUN_AS_NODE`) | `%LOCALAPPDATA%\GigaCAD\bin\giga.cmd` with the same trick, and that folder added to the user PATH |
| **Package** (`electron-builder.yml`: ad-hoc signed DMG; `dist.mjs` refuses non-Mac) | NSIS per-user installer (`win` target, x64), code-signed through Azure Trusted Signing. `dist.mjs` gains `--win`, built on the `windows` CI runner. |
| **Updates** (`updates.ts`): signed bundles, unpacked with `/usr/bin/tar`, and `dmgUrl` for shell updates | Bundles are unchanged, since they're JS. Unpack with `tar.exe` (in Windows since 1803, so **the minimum becomes Windows 10 1809**; update the download page). The manifest's `dmgUrl` becomes per-platform installer URLs. That changes `SIGNED_FIELDS`, so the release script and `updates.test.ts` move together. |
| **Save watching** (`fs.watch`) | Same. Recursive watching works on Windows. Keep the 5 s quiet period: SolidWorks saves by writing a temp file and renaming it. |
| **Case-sensitivity:** APFS is usually case-insensitive | NTFS is too. The CLI already refuses paths that differ only in case and names Windows can't store. |

## Plugins

The framework is built in `clients/desktop/src/main/plugins/`.

**Plugins are built in.** A `GigaPlugin` is an object compiled into the signed code bundle and listed in `builtInPlugins()`. Nothing is loaded from disk, so updates replace plugins with the rest of the app and there's no plugin-trust question.

Everything on a plugin is optional except its identity (id, name, version):
- `fileTypes`: extensions, display names, kinds (part, assembly, drawing, other), and whether they reference other files
- `ignorePatterns`: temp, lock, and backup files the CAD program writes, on top of `packages/core`'s defaults
- `findInstallations()`: installed versions, and whether the add-in is registered, for Settings → Plugins
- `commands` / `runCommand()`: extra context-menu entries
- `addIn`: the add-in's `clientId`, and hooks for when it connects or disconnects

`PluginRegistry` combines the plugins:
- It refuses bad or duplicate ids.
- A contested extension goes to the first plugin by id.
- It guards every call: a capability that throws is logged and turned off for that plugin until restart, and the app carries on.
- `status` feeds the Settings list.

The **SolidWorks plugin** (`solidworks.ts`):
- **File types:** `.sldprt`, `.sldasm`, `.slddrw`, plus library features, blocks, sheet formats, and form tools.
- **Ignore patterns:** kept equal to the SolidWorks section of `packages/core/src/ignore.ts` by a test.
- **Installations:** read from `HKLM\SOFTWARE\SolidWorks\SOLIDWORKS <year>\Setup` through `reg.exe`, because the app ships no native modules. The add-in's registration is checked under `Addins\{418f9708-1a89-47aa-a633-86bb665d1fad}`.
- **Add-in:** client id `solidworks`.

### Pipe protocol (v1)
A CAD add-in talks to the app over a named pipe, which `PluginPipeServer` serves.

- **Pipe:** `\\.\pipe\GigaCAD.Host.<domain>.<user>`. The add-in computes the same name (`PipeNames.ForCurrentUser` in C#, `currentPipeName` in TypeScript). Off Windows the server listens where .NET's client looks (`<tmp>/CoreFxPipe_<name>`), so the C# client can be tested anywhere.
- **Access:** Node creates the pipe with Windows' default security, which lets only the owner, administrators, and SYSTEM open it for writing. The server sends nothing until a valid `host.hello`, so other users learn nothing. Off Windows the socket is `chmod 600`.
- **Framing:** a 4-byte little-endian length, then UTF-8 JSON, 16 MiB at most.
- **Messages:** shaped like JSON-RPC 2.0. Errors use the API's `{ code, message, details }`, and API error codes such as `checked_out` and `stale_head` pass through unchanged.
- **One definition, two languages:** `clients/desktop/test/plugins/fixtures/pipe-protocol.json` holds example messages that both the TypeScript and C# tests must produce and read.

| Method | Direction | Purpose | The app will |
|---|---|---|---|
| `host.hello` | add-in → app | Must be first: client id and version, protocol version, CAD name and version, process id. Refused with `protocol_version`, `unknown_client`, or `bad_request`. | (built) |
| `files.getState` | add-in → app | For each path: is it in the GigaCAD folder, which project and branch, is it writable, and who holds the checkout. Drives the read-only banner. | `locate()` + the engine's branch state |
| `branch.checkout` / `branch.checkin` | add-in → app | Check out or in from any path in the branch | the same `giga` calls as the context menu |
| `branch.commitVersion` | add-in → app | A version with a message and optional label | `giga commit` |
| `files.reportReferences` | add-in → app | References from `GetDependencies2` | `PUT /v1/projects/:id/blobs/:sha256/references` |
| `exports.attach` | add-in → app | A STEP or STL export | `giga export` |
| `candidate.submitRebuildReport` | add-in → app | The rebuild report for a candidate | `giga rr rebuild-report` |
| `files.stateChanged` | app → add-in | Notification: these paths changed state | `broadcast()` on engine state changes |

Every method except `host.hello` answers `not_implemented` until the app registers handlers with `server.handle()` (milestone W4).

**Before release:** the add-in should check that the pipe's server process is our signed `GigaCAD.exe` (`GetNamedPipeServerProcessId`), so another program can't claim the pipe name first.

## SolidWorks add-in (`clients/windows/src/GigaCAD.SolidWorks.AddIn`)
- **COM class:** .NET Framework 4.8, `ISwAddin`, `[Guid("418f9708-1a89-47aa-a633-86bb665d1fad")]`. That GUID must match `SOLIDWORKS_ADDIN_GUID`.
- **Registration:** the installer runs `regasm /codebase` and writes `HKLM\SOFTWARE\SolidWorks\Addins\{guid}`, only when SolidWorks is installed. This is the one per-machine step. The installer asks for elevation for it, and the rest installs per user.
- **Interop DLLs** come from the SolidWorks install (`SOLIDWORKS_INTEROP_DIR`) at build time and are never committed. The add-in builds on the Windows laptop, not in CI.
- **Connecting:** on `ConnectToSW` it connects with `GigaCadHostClient` (`clientId: "solidworks"`). If the app isn't running it retries in the background, and the Task Pane says so.
- **Task Pane:** the project, branch, and checkout holder for the active document; Check Out / Check In, Commit Version, and Open Release Request; Rebuild candidate in candidate folders.
- **On open:** `files.getState`. A file you can't write opens read-only with a banner saying "Checked out by @sam".
- **On version commit:**
  1. `GetDependencies2` for each assembly and drawing → `files.reportReferences`.
  2. A coarse STL of each changed part and assembly (`SaveAs3`) → `exports.attach`.
  3. Autosaves don't export.
- **Rebuild candidate** ([the product plan](../product/plan.md), rule 7):
  1. Open each top-level assembly.
  2. Repoint replaced items with `ReplaceReferencedDocument`.
  3. `ForceRebuild3`.
  4. Collect rebuild and mate errors.
  5. Export STEP AP242 and a fine STL.
  6. Save → `candidate.submitRebuildReport`.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| — | Plugin framework | **Built.** Registry, pipe server, SolidWorks plugin, the C# protocol library, and shared fixtures. Tested on macOS and in CI on Windows, including a .NET Framework 4.8 client talking to the app's pipe |
| W1 | App runs on Windows | **Built (#46).** Paths, window chrome, tray, `gigacad://` and `--action` launches, Windows update manifest and `tar.exe`, NSIS installer in CI, plugin host started, Settings → CAD programs |
| W2 | Locks | **Built (#47).** Read-only attribute on files, `icacls` deny entries on folders, tested on `windows-latest` |
| W3 | Explorer | **Built (#48).** GigaCAD submenu in HKCU limited to the GigaCAD folder, `desktop.ini` folder icons, `giga.cmd` on PATH, uninstaller cleanup |
| W4 | Add-in methods | **Built (#49).** Pipe handlers backed by the sync engine; `files.stateChanged` broadcasts. Rebuild reports wait for candidates in the folder |
| W5 | Add-in basics | Task Pane, read-only banner, references, reconnecting, pipe server check. **Needs the Windows PC with SolidWorks.** |
| W6 | Exports and rebuild | STL on version commits; candidate rebuild with STEP and STL. **Needs the Windows PC with SolidWorks.** |
| W7 | Ship | Release workflow builds and uploads the installer and the Windows manifest, and the website links it (**built, #50**). Still to do: code signing, and the installer registering the add-in |
| Later | Virtual drive | Cloud Files sync root for on-demand files (the original design in the product plan), when downloading whole branches gets too slow |

## Verification
- **Automated, every pull request:**
  - `pnpm test`: plugin tests, macOS/Linux sockets.
  - `windows` CI job: `dotnet test` on .NET 10 and 4.8; the plugin tests over real Windows named pipes; and the interop test, with the .NET Framework 4.8 client against the app's pipe server.
  - Each milestone adds its own tests on `windows-latest` (locks, context-menu registration, installer).
- **Locally:** `pnpm test:windows` runs the .NET tests. `GIGACAD_INTEROP=1 pnpm vitest run clients/desktop/test/plugins/interop.test.ts` runs the interop test after `dotnet build clients/windows/tests/GigaCAD.Plugins.InteropClient`.
- **Manual, on the Windows laptop with SolidWorks:** the checklist in the product plan's Verification section, plus:
  1. Settings → Plugins shows SolidWorks with the installed version and the add-in registered.
  2. Opening SolidWorks shows the add-in connected.
  3. Quitting GigaCAD while SolidWorks is open shows "GigaCAD isn't running" in the Task Pane, and the add-in reconnects when the app starts again.
