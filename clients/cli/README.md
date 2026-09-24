# giga

`giga` is the GigaCAD command line. Use it to sign in, clone a branch into a folder, commit versions, and release to main. It runs on macOS, Windows, and Linux with Node 22 or newer.

It does not provide the Explorer virtual drive or run SolidWorks rebuilds. Those come from the Windows app and the SolidWorks add-in.

## Install

```sh
npm install -g @gigacad/cli
giga --version
```

## Quick start

```sh
giga login                                   # approve the code in your browser
giga project create robot-arm
giga branch create dev --project <you>/robot-arm
giga clone <you>/robot-arm --branch dev      # creates ./robot-arm
cd robot-arm
giga checkout                                # take the branch's write lock
# ...edit files in CAD...
giga status
giga commit -m "Stronger gripper" --label "rev B"
giga checkin                                 # let others check it out
```

Release it to main:

```sh
giga rr open --title "Stronger gripper"      # freezes the branch
giga rr diff                                 # what changed on the branch and on main
giga rr candidate
giga rr approve
giga rr release                              # becomes the next permanent release, e.g. v3
```

## Signing in

`giga login` starts a device sign-in. It prints a code and a link, opens your browser, and waits. Approve the code at `app.gigacad.site/device` while signed in. Use `--no-browser` on a machine without one.

The token is saved in `config.json` in your user config folder, readable only by you:

| Platform | Folder |
|---|---|
| macOS, Linux | `$XDG_CONFIG_HOME/giga` or `~/.config/giga` |
| Windows | `%APPDATA%\giga` |

Set `GIGA_CONFIG_DIR` to use another folder. Sign-ins are saved per API URL, so local and production sign-ins never mix.

- `giga whoami` shows who you are signed in as.
- `giga logout` revokes this computer's token on the server and removes it locally.
- For CI, set `GIGA_TOKEN` to a device token. It takes precedence over the saved sign-in and is never written to disk.

`giga` never prints tokens or upload/download links, including with `--json`.

## Workspaces

`giga clone <owner>/<project> --branch <name> [directory]` downloads the branch's latest commit into a new or empty folder. It checks every file's SHA-256 before putting it in place. The folder becomes a workspace; `giga` keeps its state in `.giga/`:

- the API, project, and branch the folder tracks
- this computer's machine name, used for the branch lock
- the commit the files were last synced to (the *head*)
- each file's item ID, which keeps a file's identity and history across renames

Commands run from anywhere inside the workspace.

| Command | What it does |
|---|---|
| `giga checkout` | Takes the branch's exclusive write lock for this computer, then pulls the latest commit |
| `giga pull` | Downloads the branch's latest commit. Local edits to files the branch didn't change are kept |
| `giga status` | Lists local changes, who holds the lock, and whether the branch has newer commits |
| `giga mv <from> <to>` | Moves or renames a file or folder so each file keeps its item ID |
| `giga commit -m <message> [--label <label>]` | Uploads changed files and records a version of the whole folder |
| `giga checkin [--force]` | Gives up the lock |

**What gets committed.** A commit snapshots every file in the workspace except `.giga/` and ignored files. CAD lock and backup files are ignored by default, including `~$*`, `*.bak`, `Backup of *`, `.DS_Store`, and `Thumbs.db`. A `.gigaignore` file at the root adds more patterns in `.gitignore` syntax; the `.gigaignore` file itself is committed. Files already on the branch are never ignored.

**What is refused.** Commits fail on symbolic links, on names Windows can't store (such as `a?.SLDPRT` or names ending in a dot or space), and on two paths that differ only in letter case.

**Renames.** A file renamed with your file manager shows up as a deleted file plus a new one, so its history starts over. Use `giga mv` to keep the file's identity.

**Protecting local work.** `giga pull` and `giga checkout` refuse to overwrite a file you changed if the branch also changed it. They also refuse to replace an untracked file that sits where a branch file would go. In either case nothing is changed. `giga checkin` refuses while you have uncommitted changes, unless you pass `--force`; your files stay on disk either way.

## Projects, branches, releases

```sh
giga project list
giga project show alex/robot-arm
giga branch list --project alex/robot-arm
giga branch create experiment --project alex/robot-arm --from-release 2
giga release list --project alex/robot-arm
giga release show v3 --project alex/robot-arm
giga release export 3 ./robot-arm-v3 --project alex/robot-arm   # verified copy, not a workspace
```

Inside a workspace, `--project` defaults to the workspace's project.

## Release requests

`giga rr` (or `giga release-request`) drives diff pick. It uses the workspace's active request by default; otherwise pass a number (`3` or `#3`) with `--project`.

```sh
giga rr open [--title <title>] [--body <text>] [--branch <name>]
giga rr list [--all]
giga rr show [request]
giga rr diff [request]
giga rr picks [request] --file picks.json      # or --file - for stdin
giga rr candidate [request]
giga rr rebuild-report [request] --file report.json
giga rr approve [request]      # giga rr unapprove withdraws it
giga rr release [request] [--notes <text>]
giga rr close [request]
```

**Picks.** Every changed item defaults to the branch's version. A picks file overrides that per item and can make a new branch file take over an existing main file's identity (a replacement). Items can be named by path or by item ID (`giga rr diff --json` shows the IDs):

```json
{
  "actions": { "Robot.SLDASM": "keep_main", "parts/P1.SLDPRT": "keep_main" },
  "replacements": [{ "branchPath": "parts/P3.SLDPRT", "mainPath": "parts/P4.SLDPRT" }]
}
```

Replacements may use `branchItemId` and `mainItemId` instead of paths. Saving picks discards the current candidate, and approvals given on it no longer count.

**Rebuild reports.** Some projects require a clean rebuild report before release. `giga` does not rebuild anything. It only attaches a report that a CAD rebuild produced, and the report must name the candidate it checked:

```json
{
  "candidateManifestId": "<from giga rr show --json>",
  "status": "passed_with_warnings",
  "messages": [{ "level": "warning", "message": "Mate is over-defined", "path": "Robot.SLDASM" }]
}
```

## JSON output

Add `--json` to any command for scripts. On success, stdout carries exactly one JSON document. On failure, the exit code is 1, stdout is empty, and stderr carries:

```json
{ "error": { "code": "stale_head", "message": "…", "hint": "…", "status": 409, "details": {} } }
```

`code` is stable. Progress messages are not printed with `--json`. The `giga login` code and link still go to stderr.

## Choosing the API

`giga` uses `https://api.gigacad.site` by default. The API is chosen in this order: `--api-url`, then `GIGA_API_URL`, then the API a workspace was cloned from, then the default. Inside a workspace, pointing at a different API is an error.

### Local development

From the repository root, with Docker running:

```sh
supabase start
docker compose up -d                       # MinIO, the local stand-in for R2
cp apps/api/.env.example apps/api/.env
pnpm --filter @gigacad/api dev             # API on http://127.0.0.1:8787
pnpm --filter @gigacad/web dev             # web app for approving sign-ins
pnpm --filter @gigacad/cli build
export GIGA_API_URL=http://127.0.0.1:8787
node clients/cli/dist/giga.js login
```

Tests:

```sh
pnpm test                                   # unit tests, no services needed
pnpm test:integration                       # CLI against the real local API and MinIO
pnpm --filter @gigacad/cli smoke            # pack, install, and run the npm package
```

## Recovering from errors

| Error | What happened | What to do |
|---|---|---|
| `expired_token` | The sign-in code wasn't approved within 10 minutes | Run `giga login` again |
| `unauthorized` | You're signed out, or the token was revoked | Run `giga login` |
| `stale_head` | Someone committed since your last sync. Nothing was uploaded or changed | `giga pull`, then commit again |
| `not_checked_out` / `checked_out` | You don't hold the branch lock | `giga checkout`, or ask the holder to check in |
| `pull_conflicts` | The branch changed files you also changed | Copy your versions out of the workspace and delete them there. Run `giga pull`, copy back what you need, and commit |
| `upload_failed`, `file_changed` | A file changed or the connection dropped mid-upload | Save and close your CAD files, then commit again. Files that already uploaded aren't sent again |
| `download_failed`, `download_corrupt` | A download failed or didn't match its checksum. Nothing was put in place | Run the command again |
| `main_moved` | Main got a new release after the candidate was built | `giga rr candidate`, then approve again |
| `approval_required` | Approvals or a rebuild report are missing | `giga rr show` lists what's missing |

A failed commit never changes the workspace's recorded state. It's always safe to fix the cause and run the same command again.
