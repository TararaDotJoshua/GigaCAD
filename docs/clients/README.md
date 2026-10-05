# Clients

Three programs people run on their own computers. Each has its own README for building, running, and releasing.

Plan in this folder: [windows-app-plan.md](windows-app-plan.md), covering the Windows port, the plugin framework, the pipe protocol, the SolidWorks add-in, and milestones W1–W7.

## `giga` CLI (`clients/cli`)

The command line, published on npm as `@gigacad/cli` (0.1.0, `UNLICENSED`, bundled into one file with no runtime dependencies). It's for power users and end-to-end tests, and the desktop app runs it in-process.

- **Commands:** `login`, `logout`, `whoami`, `project`, `clone`, `branch`, `checkout`, `checkin`, `commit` (`--autosave`), `status`, `pull`, `push`, `mv`, `rr`, `release` (`export`), `export`, `root`, `open`, `show`, `list`. They're grouped in `src/commands/`.
- **Workspaces:** a cloned branch is a folder with a `.giga/` directory recording the project, branch, and base. `scan.ts` hashes local files, `sync.ts` plans pulls and commits, and `transfer.ts` uploads and downloads in batches through presigned URLs. `giga root` syncs a project's root files with a folder (`rootSync.ts`, `rootWorkspace.ts`).
- **Sign-in** uses the device-code flow ([auth/](../auth/README.md)) and stores the token in `~/.config/giga/config.json` (`%APPDATA%\giga` on Windows).
- **Release:** bump `clients/cli/package.json`, then `pnpm --filter @gigacad/cli publish` from `main`. npm asks for a passkey in the browser.

Details: `clients/cli/README.md`.

## Desktop app (`clients/desktop`)

An Electron app for macOS and Windows. It makes each project a real folder laid out like the web directory:

```
~/GigaCAD/<owner>/<project>/          (%USERPROFILE%\GigaCAD on Windows)
  <root files and folders>   two-way synced; each save is a new revision
  Branches/<name>/           a giga workspace; editable only while you have it checked out
  Releases/v<N>/             read-only
```

| Area | Files (`src/`) |
|---|---|
| Startup and updates | `bootstrap/` picks the newest signed code bundle from `downloads.gigacad.site` and falls back if it crashes. `main/updates.ts` downloads and verifies bundles |
| Engine | `main/controller.ts` wires it together. `main/sync.ts` (`SyncEngine`) watches folders and turns saves into autosaves after 5 s of quiet. `main/cli.ts` runs `giga` in-process |
| Locks | `main/locks.ts`: `chmod` then `chflags uchg` on macOS; the read-only attribute and `icacls` deny entries on Windows |
| OS integration | `main/icons.ts` and `iconArt.ts` (branded folder icons), `main/quickActions.ts` (Finder Quick Actions, Explorer submenu), `gigacad://` links, the tray, and `main/cliInstall.ts` (a terminal `giga`) |
| CAD plugins | `main/plugins/`: the plugin registry, the named-pipe server for add-ins, and the SolidWorks plugin |
| Window | `renderer/` (React), `preload/`, and `shared/` types |

There's no Apple Developer account, so the macOS app ships as an ad-hoc signed DMG ("Open Anyway" once) with no File Provider or Finder Sync extension. Windows ships as an NSIS installer, which isn't code-signed yet. Nothing is published yet ([roadmap](../product/roadmap.md)).

Details: `clients/desktop/README.md`.

## SolidWorks add-in and protocol (`clients/windows`)

- `GigaCAD.Plugins.Protocol` (netstandard2.0) is built: the add-in's side of the pipe protocol (`GigaCadHostClient`, framing, messages), with tests on .NET 10 and .NET Framework 4.8 and an interop client tested against the desktop app's pipe server in CI.
- `GigaCAD.SolidWorks.AddIn` (.NET Framework 4.8 COM) is **planned, not built**. It needs a Windows PC with SolidWorks, because the interop DLLs come from the install and are never committed.

The pipe is `\\.\pipe\GigaCAD.Host.<domain>.<user>`. Messages are length-prefixed JSON shaped like JSON-RPC: `host.hello`, `files.getState`, `branch.checkout` and `checkin`, `branch.commitVersion`, `files.reportReferences`, `exports.attach`, `candidate.submitRebuildReport`, and the `files.stateChanged` notification. Both languages test against the shared fixtures in `clients/desktop/test/plugins/fixtures/pipe-protocol.json`.

Details: `clients/windows/README.md` and [windows-app-plan.md](windows-app-plan.md).
