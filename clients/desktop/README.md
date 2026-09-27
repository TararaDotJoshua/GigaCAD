# GigaCAD for macOS

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

## How it's put together

- `src/bootstrap/`: the app's entry, shipped in the `.app`. It picks the newest verified code
  bundle and starts it. Changing anything here, or the Electron version, needs a
  `SHELL_VERSION` bump in `src/bootstrap/shell.ts`.
- `src/main/`: the code bundle's main process: sync engine, locks, Finder icons, Quick Actions,
  the updater, and the window and menu bar item.
- `src/preload/` and `src/renderer/`: the window (React).
- `scripts/`: `build.mjs` (shell and signed bundle into `out/`), `dev.mjs`, and `icons.mjs`
  (pre-renders Finder icons into `build/`; needs a Mac).

Builds are signed with `DESKTOP_UPDATE_KEY`, `GIGACAD_UPDATE_KEY_FILE`, or
`~/.config/gigacad/desktop-update-key.pem`. Without any of them, a throwaway key in `.keys/`
signs the build, and that build only accepts bundles signed on the same computer.
