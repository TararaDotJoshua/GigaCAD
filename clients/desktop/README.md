# GigaCAD for macOS and Windows

Your GigaCAD projects as folders in Finder, like the web directory:

```
~/GigaCAD/<owner>/<project>/
  <root files and folders>   two-way synced; each save is a new revision
  Branches/<name>/           a giga workspace; editable only while you have it checked out
  Releases/v<N>/             read-only
```

Saves in a branch you hold become autosaves after 5 seconds of quiet. Commit Version, Check Out,
Check In, Pull, Download, and Copy Link are in the window and in Finder's right-click menu
(Quick Actions). The app runs the `giga` CLI in-process, and shares its sign-in.

## Develop

```sh
pnpm install
pnpm --filter @gigacad/desktop dev
```

`dev` builds once, then watches: main-process changes restart the app, and the window reloads
from the Vite dev server on port 5178. Arguments after `--` go to Electron, for example
`pnpm --filter @gigacad/desktop dev -- --remote-debugging-port=9222`.

To keep a test run away from your real `~/GigaCAD`, point the app at a scratch support folder
whose `settings.json` names another GigaCAD folder:

```sh
mkdir -p /tmp/gigacad-dev/support
echo '{ "folder": "/tmp/gigacad-dev/GigaCAD" }' > /tmp/gigacad-dev/support/settings.json
GIGACAD_SUPPORT_DIR=/tmp/gigacad-dev/support pnpm --filter @gigacad/desktop dev
```

In development, `gigacad://` links (and so the Quick Actions) open the stock Electron app
instead of GigaCAD. Test them with a packaged build.

Unit tests run with the rest of the repository (`pnpm test`). The lock tests need macOS.

## Package

```sh
pnpm --filter @gigacad/desktop dist                         # dist/GigaCAD-<version>-universal.dmg
pnpm --filter @gigacad/desktop dist -- --dir --arch x64     # just the .app, one architecture: faster
```

`dist` renders the Finder icons, builds and signs the bundle, runs electron-builder (ad-hoc
signature, no Apple account), and then `scripts/check-package.mjs`, which fails on any
`node_modules`, native module, or built-in bundle the app wouldn't accept. The CI `desktop` job
does the same on every pull request and uploads the DMG.

## Release

Code changes reach installed apps as over-the-air updates:

1. Bump `version` in `package.json` and merge to `main`.
2. Run the **Desktop release** workflow. It signs the bundle with `DESKTOP_UPDATE_KEY`,
   uploads it to `downloads.gigacad.site/desktop/stable/`, and then uploads the manifest that
   installed apps check every 6 hours.
3. Check **dmg** too when `SHELL_VERSION` changed (a new Electron or bootstrap). Apps on the
   older shell then show "New version available · Needs a fresh download".

`scripts/release.mjs` makes the same files locally in `release/`. To try an update without
publishing it, serve that folder and start the app with
`GIGACAD_UPDATE_URL=http://127.0.0.1:<port>/desktop/stable/manifest.json` (build the release
with `GIGACAD_DOWNLOADS_URL=http://127.0.0.1:<port>/desktop` so the manifest points there).

The signing key: `scripts/keygen.mjs` makes one; its public half is in
`src/bootstrap/publicKey.ts`. Keep the private half in the `DESKTOP_UPDATE_KEY` secret and a
backup. Losing it means shipping a new DMG to change keys.

## Windows

The same app runs on Windows ([docs/clients/windows-app-plan.md](../../docs/clients/windows-app-plan.md) tracks the port).

- **Where things live:**
  - Settings, bundles, and caches are in `%LOCALAPPDATA%\GigaCAD`, and projects are in `%USERPROFILE%\GigaCAD`.
  - The window draws Windows' caption buttons over its toolbar.
  - The tray icon opens the window on click.
- **Launching:** `gigacad://` links and the File Explorer menu start the app with arguments (`launchArgs.ts`) instead of macOS's `open-url`.
- **File Explorer menu** (`explorerMenu.ts`):
  - A **GigaCAD** submenu with the Quick Actions' entries, under `HKCU\Software\Classes`, so no administrator is needed.
  - `AppliesTo` limits it to items inside the GigaCAD folder.
  - On Windows 11 it's under "Show more options". The uninstaller removes it (`installer/uninstall.nsh`).
- **Locks:** files get the read-only attribute, and folders get a deny entry for add, rename, and delete (`locks.ts`).
- **Icons:**
  - Folders get icons through a hidden `desktop.ini` naming an `.ico`. `pnpm icons` packs those `.ico` files on a Mac.
  - Windows can't give single files their own icons.
- **Terminal:** `giga.cmd` in `%LOCALAPPDATA%\GigaCAD\bin`, added to the user's PATH, runs the CLI with the app's own Node.
- **Plugins:** Settings lists the CAD programs GigaCAD's plugins found, SolidWorks for now.
- **Package it on Windows:**

  ```sh
  pnpm --filter @gigacad/desktop dist                       # dist/GigaCAD-Setup-<version>.exe
  ```

  Icons are rendered on a Mac (`pnpm icons` writes `build/`); copy `build/` over, or pass `--allow-missing-icons`.
- **CI:** the `windows` job runs the desktop tests on Windows and uploads an unsigned installer (the `GigaCAD-Windows` artifact) to try. It uses a throwaway update key and has no icons.

## Plugins

CAD-specific behavior (SolidWorks first) comes from plugins in `src/main/plugins/`. The Windows plan in [docs/clients/windows-app-plan.md](../../docs/clients/windows-app-plan.md) covers the design.

- **Plugins:** a plugin is a `GigaPlugin` object (`types.ts`). It can supply file types, ignore patterns, installed versions of its CAD program, menu commands, and its add-in's `clientId`. Plugins are compiled into the signed bundle; add one to `builtInPlugins()` in `index.ts`.
- **Registry:** `PluginRegistry` combines them and turns off any capability that throws.
- **Pipe server:** `PluginPipeServer` is the pipe CAD add-ins connect to (`\\.\pipe\GigaCAD.Host.<domain>.<user>` on Windows).
  - Framing and messages are in `protocol.ts`. `test/plugins/fixtures/pipe-protocol.json` keeps them in step with the add-ins' C# library in `clients/windows`.
  - Every add-in method answers `not_implemented` until the app registers handlers with `server.handle()`.
- **Not wired in yet:** `createPluginHost()` isn't called by the app yet; that's milestone W1 of the Windows plan.
- **Interop test:** `test/plugins/interop.test.ts` runs the C# client against the pipe server. It needs the .NET SDK, and runs in the `windows` CI job with .NET Framework 4.8:

  ```sh
  dotnet build clients/windows/tests/GigaCAD.Plugins.InteropClient
  GIGACAD_INTEROP=1 pnpm vitest run clients/desktop/test/plugins/interop.test.ts
  ```

## How it's put together

- `src/bootstrap/`: the app's entry, shipped in the `.app`. It picks the newest verified code
  bundle and starts it. Changing anything here, or the Electron version, needs a
  `SHELL_VERSION` bump in `src/bootstrap/shell.ts`.
- `src/main/`: the code bundle's main process: sync engine, locks, Finder icons, Quick Actions,
  the updater, and the window and menu bar item.
- `src/preload/` and `src/renderer/`: the window (React).
- `scripts/`: `build.mjs` (shell and signed bundle into `out/`), `dev.mjs`, `icons.mjs`
  (pre-renders Finder icons into `build/`; needs a Mac), `dist.mjs`, `release.mjs`, and
  `check-shell.mjs` (fails when the shell changed without a `SHELL_VERSION` bump).

Builds are signed with `DESKTOP_UPDATE_KEY`, `GIGACAD_UPDATE_KEY_FILE`, or
`~/.config/gigacad/desktop-update-key.pem`. Without any of them, a throwaway key in `.keys/`
signs the build, and that build only accepts bundles signed on the same computer.
