# Windows PC runbook

The Windows work that needs a real PC, in order. Tick the boxes as you go, and note anything that looks wrong next to its step. [The Windows app plan](windows-app-plan.md) explains the design behind each part.

Parts 1–3 need only the PC. Part 4 can happen anywhere, since it's Azure setup in a browser. Part 5 needs SolidWorks on the PC.

**Note:** the website's "Download for Windows" button links to `downloads.gigacad.site/desktop/GigaCAD-Setup.exe`, which doesn't exist until Part 2 runs. Until then the button gives a 404.

## Before you start

- A Windows 10 (1809 or later) or Windows 11 PC, 64-bit.
- Two GigaCAD accounts: your own, and a second one for the locking checks. A `+suffix` address works for the second.
- A test project you own, with a release and at least one branch, holding a few files. A small SolidWorks assembly with its parts is best.

## Part 1: try the CI build (about 30 minutes)

The `windows` CI job builds an installer for every pull request. It's unsigned, has no custom icons, and only accepts updates built on that CI runner, so it's for testing only.

1. On github.com, open the latest successful **CI** run on `main` (Actions → CI). Download the `GigaCAD-Windows` artifact and unzip it.
2. Run `GigaCAD-Setup-<version>.exe`. SmartScreen will warn that it's unrecognized: choose **More info**, then **Run anyway**.
   - [ ] It installs without asking for an administrator, and GigaCAD opens.
   - [ ] It installs to `%LOCALAPPDATA%\Programs\GigaCAD`.
3. **Sign in**
   - [ ] Signing in opens the browser with a code. After you approve it, the app shows your projects.
4. **Sync**
   - [ ] `%USERPROFILE%\GigaCAD\<owner>\<project>` appears, with the root files, `Branches\` and `Releases\`.
   - [ ] Files match the web app. Open one to check it isn't empty or corrupt.
   - [ ] Add a file to the project's root folder in File Explorer. Within about 10 seconds it's on the web app as a new revision.
5. **Locks**
   - [ ] Files in `Releases\v<N>\` are read-only. Saving one fails, and deleting or renaming fails, as does adding a new file to the folder.
   - [ ] The same is true in a branch you haven't checked out.
6. **Explorer menu** (on Windows 11, right-click → **Show more options**)
   - [ ] Right-clicking inside the GigaCAD folder shows a **GigaCAD** submenu.
   - [ ] It doesn't appear on files outside the GigaCAD folder.
   - [ ] **Check Out** on a branch works: the branch becomes writable, and the web app shows it checked out by you.
   - [ ] Edit a file in that branch and wait about 5 seconds. An autosave appears on the web app.
   - [ ] **Commit Version** asks for a message, and the version appears on the web app.
   - [ ] **Check In** makes the branch read-only again.
   - [ ] **Copy Link** puts a working `app.gigacad.site` link on the clipboard.
   - [ ] **Pull Latest**, **Open on gigacad.site**, and **Show in GigaCAD** each do what they say.
7. **Second account**
   - [ ] Sign in to the web app as the second account, add it to the project, and check out the branch. On the PC, the branch stays read-only, and the app says who holds it.
8. **Tray and terminal**
   - [ ] The notification-area icon opens the window on click, and its menu works.
   - [ ] Closing the window leaves the app running in the tray.
   - [ ] In a **new** terminal window, `giga --help` works. `giga` is already signed in because the app shares its sign-in.
   - [ ] `gigacad://` links open the app. One way to check: run `start gigacad://` in the terminal.
9. **Settings → CAD programs**
   - [ ] SolidWorks is listed with its installed version, if it's installed.
   - [ ] It says the add-in isn't registered. That's expected until Part 5.
10. **Uninstall:** Settings → Apps → GigaCAD → Uninstall.
    - [ ] The **GigaCAD** right-click submenu is gone.
    - [ ] `%USERPROFILE%\GigaCAD` is still there. Your files are never deleted by the uninstaller.

Folder icons won't appear in this build, because the CI build has no icons. Part 2 checks them.

If something fails, write down the step and what you saw. Screenshots help, especially of the app window, which lists recent activity and errors.

## Part 2: publish the first Windows release

This publishes to production. It also sends an update to every installed copy of the macOS app, so do it only once Part 1 passes.

1. Check that `version` in `clients/desktop/package.json` on `main` is higher than the published one, which is in <https://downloads.gigacad.site/desktop/stable/manifest.json>. `main` has `0.2.0` and `0.1.0` is published, so the first run is ready. Each version can be released only once, because the bundle file is cached forever.
2. On github.com: Actions → **Desktop release** → **Run workflow** on `main`.
   - **Notes:** what's new. Mac users see this in the update banner, for example "Windows support, and fixes".
   - Check **windows**.
   - Leave **dmg** unchecked. `SHELL_VERSION` hasn't changed since the first macOS release, so Mac users don't need a new download.
3. When it finishes:
   - [ ] <https://downloads.gigacad.site/desktop/GigaCAD-Setup.exe> downloads.
   - [ ] <https://downloads.gigacad.site/desktop/stable/win32/manifest.json> shows the new version.
   - [ ] The **Download for Windows** button on <https://gigacad.site/download> works.
4. Install the release on the PC from the website, the way a new user would.
   - [ ] Everything from Part 1 still works.
   - [ ] Folders in `%USERPROFILE%\GigaCAD` now have GigaCAD icons. If they don't appear right away, sign out of Windows and back in; Explorer caches icons.
5. On a Mac with GigaCAD installed:
   - [ ] Within 6 hours, or straight away after quitting and reopening the app, it shows the update banner. After restarting, it runs the new version.

## Part 3: updates on Windows

Do this the next time a desktop release goes out, from any computer.

- [ ] The installed Windows app shows the update banner and restarts into the new version.
- [ ] Its projects and sign-in are unchanged.

## Part 4: code signing (Azure Artifact Signing)

Until the installer is signed, SmartScreen warns every new user. Microsoft's Artifact Signing service, formerly Trusted Signing, is the cheapest option at about $10 a month. Individual developers in the US and Canada can be validated.

1. In the [Azure portal](https://portal.azure.com), create a subscription if you don't have one.
2. Create an **Artifact Signing account**. Pick the region nearest you, and write down its endpoint, for example `https://eus.codesigning.azure.net`.
3. In the account, go to **Identity validation** → **New** → **Public** (individual, or organization if GigaCAD has one). Validation takes from a few hours to a few days.
4. Once validated, create a **certificate profile** of type **Public Trust**, linked to that identity.
5. In Microsoft Entra ID → **App registrations**, create a new app called `gigacad-ci-signing`. Then:
   - Create a client secret for it.
   - On the signing account, under Access control, give it the role **Artifact Signing Certificate Profile Signer**. The role may still be named "Trusted Signing Certificate Profile Signer".
6. In a terminal on your own machine, store the three secrets. `gh` prompts for each value, so they never appear in chat or in the repository:

   ```sh
   gh secret set AZURE_TENANT_ID --env production
   gh secret set AZURE_CLIENT_ID --env production
   gh secret set AZURE_CLIENT_SECRET --env production
   ```

7. Then tell Claude the four non-secret values:
   - the endpoint
   - the signing account name
   - the certificate profile name
   - the publisher name exactly as validated

Claude then:
- adds `azureSignOptions` to the Windows build,
- passes the secrets to the release workflow's `windows` job,
- removes the "isn't code-signed yet" wording from the download page and `/docs/install-windows`,
- adds the add-in's pipe check (the plan's "Before release" item), which needs the signed `GigaCAD.exe`.

After the next Windows release:
- [ ] Right-click the downloaded `GigaCAD-Setup.exe` → Properties → **Digital Signatures** shows your publisher.
- [ ] A new download installs without the "unrecognized app" screen. A new certificate may still need some downloads before SmartScreen trusts it fully.

## Part 5: the SolidWorks add-in (milestones W5 and W6)

The add-in is still to be written. It can only be built on a PC with SolidWorks, because its interop DLLs come from the SolidWorks install. The quickest route is to run Claude Code on the PC and have it build W5, then W6, from [the Windows app plan](windows-app-plan.md).

### Set up the PC once

In PowerShell:

```powershell
winget install Git.Git GitHub.cli OpenJS.NodeJS.22 Microsoft.DotNet.SDK.10 Microsoft.DotNet.Framework.DeveloperPack_4
corepack enable
gh auth login
gh repo clone TararaDotJoshua/GigaCAD $HOME\Documents\GigaCAD
cd $HOME\Documents\GigaCAD
corepack pnpm install
irm https://claude.ai/install.ps1 | iex
```

Check the setup with `corepack pnpm test:windows`, which runs the .NET tests.

Find the SolidWorks interop folder. It's usually `C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\api\redist`, and it holds `SolidWorks.Interop.sldworks.dll`. Set it for your user so builds can find it:

```powershell
[Environment]::SetEnvironmentVariable('SOLIDWORKS_INTEROP_DIR', 'C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\api\redist', 'User')
```

### Build with Claude Code

Start `claude` in the repository folder. Then ask:

> Build milestone W5 of docs/clients/windows-app-plan.md (the SolidWorks add-in basics), then W6. SolidWorks is installed on this PC, and SOLIDWORKS_INTEROP_DIR is set. Open a pull request for each milestone.

Registering the add-in with `regasm` writes to `HKLM`, so that one step needs a terminal opened with **Run as administrator**. Claude will say when.

### Test in SolidWorks

The product plan's checklist, plus the add-in's own checks. Use a sample assembly in a branch.

1. [ ] Settings → CAD programs shows SolidWorks with the add-in registered.
2. [ ] When SolidWorks starts, the GigaCAD Task Pane shows the add-in connected.
3. [ ] With GigaCAD quit while SolidWorks is open, the Task Pane says "GigaCAD isn't running". When the app starts again, the add-in reconnects.
4. [ ] Check out a branch and open the assembly from `GigaCAD\…\Branches\<branch>\`.
5. [ ] Save a part, and an autosave appears.
6. [ ] With the branch checked out by the second account, files open read-only, with a banner naming who holds it.
7. [ ] Commit a version, and the autosaves are gone.
8. [ ] Open a release request with a replace pick, and run **Rebuild candidate** in SolidWorks. The assembly loads the new part, and the rebuild report reads clean.
9. [ ] Approve and release. `Releases\v<N>\` is read-only and shows the new version.
10. [ ] Each committed part and assembly has an STL export: its thumbnail is drawn from it, and the web viewer opens it.
11. [ ] The release offers STEP and STL downloads, and the STEP opens in another CAD program.

When W5 and W6 are merged:
- The installer has to register the add-in (W7's last item).
- Run Part 2 again with a higher version, so the add-in ships.
