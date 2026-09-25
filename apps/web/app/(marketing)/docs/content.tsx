// The docs table of contents. Each page lists the headings it will cover;
// pages without `body` render those headings as unwritten sections.

export interface DocPage {
  slug: string;
  title: string;
  summary: string;
  outline: string[];
  body?: () => React.ReactNode;
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

function Concepts() {
  const terms: [string, string][] = [
    ["Project", "A folder of CAD files with its own history. Like a repository in Git. It can be public or private."],
    ["Main", "The official line of a project. It is made of releases only; nobody edits main directly."],
    ["Release", "A numbered, locked version of main: v1, v2, v3. A release can’t be edited or deleted."],
    ["Branch", "A working copy of a project, started from a release. All changes happen on branches."],
    ["Check out, check in", "Checking out a branch gives you the only write access to it. Checking in gives it back."],
    ["Autosave", "A snapshot taken every time you save a file on a checked-out branch. Autosaves are temporary."],
    ["Version", "A named snapshot of a branch, with a message. Committing a version clears the autosaves before it."],
    ["Release request", "A proposal to turn a branch into the next release. You pick, file by file, what ships."],
    ["Release candidate", "The set of files a release request would ship, rebuilt in SolidWorks and waiting for approval."],
    ["Item", "The identity of a part that lasts across renames. Replacing a part keeps its item, so its history continues."],
  ];

  return (
    <>
      <p>
        GigaCAD borrows its model from Git and GitHub, then changes the parts that don’t fit CAD. Binary
        files can’t be merged line by line, so only one person edits a branch at a time, and releases are
        assembled by picking whole files.
      </p>

      <h2 id="terms">Terms</h2>
      <dl className="doc-terms">
        {terms.map(([term, meaning]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>

      <h2 id="how-they-fit">How they fit together</h2>
      <p>
        A project starts with a first release, v1. To change anything, you start a branch from the latest
        release and check it out. Every save becomes an autosave; when you reach a point worth keeping,
        commit a version.
      </p>
      <p>
        When the branch is ready, open a release request. GigaCAD lists every file that differs from main.
        For each one, take the branch’s copy or keep main’s. GigaCAD then builds a release candidate, the
        SolidWorks add-in rebuilds its assemblies, and the project’s approvers sign off. Releasing creates
        the next locked version of main.
      </p>

      <h2 id="differences-from-git">Differences from Git</h2>
      <ul>
        <li>There’s no merging inside a file. You choose one side per file.</li>
        <li>Branches are locked to one person at a time instead of being edited in parallel.</li>
        <li>History on main can’t be rewritten. There is no force-push.</li>
        <li>Parts keep their identity when renamed or replaced, so assemblies don’t lose track of them.</li>
      </ul>
    </>
  );
}

function Command({ children }: { children: string }) {
  return (
    <pre>
      <code>{children}</code>
    </pre>
  );
}

function CommandList({ commands }: { commands: [string, React.ReactNode][] }) {
  return (
    <dl className="doc-terms doc-commands">
      {commands.map(([command, meaning]) => (
        <div key={command}>
          <dt>
            <code>{command}</code>
          </dt>
          <dd>{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

function FirstProject() {
  return (
    <>
      <p>
        This walks through a new project from empty to its first release. The GigaCAD drive for Windows
        isn’t out yet, so files go in with the <a href="/docs/cli">command-line tool</a> for now.
      </p>

      <h2 id="create-a-project">Create a project</h2>
      <p>
        Sign in at <a href="https://app.gigacad.site">app.gigacad.site</a>. The first time, choose a handle:
        it starts every project address, like <code>app.gigacad.site/alex/robot-arm</code>. Then choose{" "}
        <strong>New project</strong>, give it a name, and pick who can see it. Private projects are visible
        only to their members. Public projects can be viewed by anyone, but only members can change them.
      </p>
      <p>From the command line, the same thing is:</p>
      <Command>{`giga project create robot-arm --name "Robot arm"`}</Command>

      <h2 id="add-your-files">Add your files</h2>
      <p>
        Files never go straight onto main. Start a branch, download it into a folder, check it out, and
        copy your files in:
      </p>
      <Command>{`giga branch create first-upload --project alex/robot-arm
giga clone alex/robot-arm --branch first-upload robot-arm
cd robot-arm
giga checkout`}</Command>
      <p>
        Copy your assembly, parts, and drawings into the <code>robot-arm</code> folder, keeping the folder
        layout your assemblies expect. Then upload them as a version:
      </p>
      <Command>{`giga status
giga commit -m "First upload" --label "rev A"`}</Command>
      <p>
        <code>giga status</code> lists what will be uploaded. Temporary and backup files are skipped
        automatically; see <a href="/docs/ignored-files">Ignored files</a>.
      </p>

      <h2 id="make-release-v1">Make release v1</h2>
      <p>
        Open the branch in the web app and choose <strong>Open release request</strong>, or run{" "}
        <code>giga rr open --title "First release"</code>. Opening a request checks the branch in and freezes
        it until the request is released or closed.
      </p>
      <p>
        On the release request, every file shows up as new on the branch, set to <strong>Add as new</strong>.
        Choose <strong>Generate candidate</strong>, then <strong>Approve candidate</strong>. New projects
        need one approval from an owner or maintainer, and you may approve your own request. Once the
        approval is in, choose <strong>Release v1</strong>. Main now shows your files, locked as v1.
      </p>

      <h2 id="invite-people">Invite people</h2>
      <p>
        In the project’s <strong>Settings</strong>, add people by their handle and pick a role. Viewers can
        see and download files. Contributors can also make branches, commit, and open release requests.
        Maintainers can also change settings and approval rules, add and remove viewers and contributors,
        and release someone else’s checkout lock. The owner can do everything, including adding maintainers
        and deleting the project.
      </p>
    </>
  );
}

function IgnoredFiles() {
  return (
    <>
      <p>
        CAD programs and operating systems write lock files, temporary files, and backups next to your real
        files. GigaCAD never uploads them, so they don’t clutter history or use your storage.
      </p>

      <h2 id="built-in-rules">Built-in rules</h2>
      <p>These patterns are always ignored, in every folder, regardless of letter case:</p>
      <ul>
        <li>
          <code>~$*</code>, <code>*.tmp</code>, <code>*.bak</code>: SolidWorks lock and temporary files
        </li>
        <li>
          <code>Backup of *</code>, <code>Backup (*) of *</code>, <code>AutoRecover of *</code>: SolidWorks
          backups
        </li>
        <li>
          <code>*.FCBak</code>, <code>.~lock.*#</code>: FreeCAD backups and LibreOffice lock files
        </li>
        <li>
          <code>.DS_Store</code>, <code>Thumbs.db</code>, <code>desktop.ini</code>: files macOS and Windows
          add to folders
        </li>
      </ul>

      <h2 id="add-your-own-rules">Add your own rules</h2>
      <p>
        Put a file named <code>.gigaignore</code> in the top folder of the project. It uses the same syntax
        as <code>.gitignore</code>, one pattern per line, and matching ignores letter case:
      </p>
      <Command>{`# Exported copies we regenerate from the models
exports/
*.STEP

# Scratch work
scratch/`}</Command>
      <p>
        <code>.gigaignore</code> is committed like any other file, so everyone working on the project gets
        the same rules. Rules only apply to new files: a file that’s already on the branch keeps being
        versioned even if a pattern matches it later.
      </p>
      <p>
        Two kinds of file can’t be versioned at all: symbolic links, and names Windows can’t store, such as
        names containing <code>:</code> or <code>?</code>. <code>giga commit</code> stops and lists them.
        Rename them or add them to <code>.gigaignore</code>.
      </p>
    </>
  );
}

function Cli() {
  return (
    <>
      <p>
        <code>giga</code> does everything the web app does from a terminal: projects, branches, check out
        and check in, versions, release requests, and exporting releases. Use it to script GigaCAD, to work
        on macOS or Linux, or in CI.
      </p>

      <h2 id="install">Install</h2>
      <p>
        <code>giga</code> needs <a href="https://nodejs.org">Node.js</a> 22 or later. Install it from npm:
      </p>
      <Command>{`npm install -g @gigacad/cli
giga --version`}</Command>

      <h2 id="sign-in">Sign in</h2>
      <Command>giga login</Command>
      <p>
        This opens <code>app.gigacad.site/device</code> in your browser with a code. Check that the code
        matches your terminal, then approve it. <code>giga</code> saves a device token for this computer in{" "}
        <code>~/.config/giga</code> on macOS and Linux, or <code>%APPDATA%\giga</code> on Windows. Use{" "}
        <code>giga login --no-browser</code> to print the link instead of opening it.
      </p>
      <p>
        <code>giga whoami</code> shows who you’re signed in as. <code>giga logout</code> revokes this
        computer’s token. You can also sign devices out under <strong>Account</strong> in the web app.
      </p>

      <h2 id="workspaces">Workspaces</h2>
      <p>
        <code>giga clone</code> downloads one branch into a new folder, called a workspace. Commands you run
        inside a workspace act on its project and branch, so most of them need no arguments. Outside a
        workspace, pass <code>--project owner/project</code>. The workspace keeps its state in a{" "}
        <code>.giga</code> folder; don’t edit or copy it.
      </p>

      <h2 id="a-typical-session">A typical session</h2>
      <Command>{`giga branch create gripper-v2 --project alex/robot-arm
giga clone alex/robot-arm --branch gripper-v2 gripper
cd gripper
giga checkout      # take the write lock, get the latest files
# ...edit files in SolidWorks...
giga status        # see what changed
giga commit -m "Stiffer jaw" --label "rev B"
giga checkin       # give the lock back`}</Command>
      <p>
        Only the person who has a branch checked out can commit to it. If someone else holds the lock,{" "}
        <code>giga checkout</code> says who. <code>giga checkin</code> refuses while you have uncommitted
        changes; <code>--force</code> checks in anyway and leaves your local files alone.
      </p>
      <p>
        <code>giga pull</code> never overwrites local changes. If a newer commit touches a file you changed,
        it stops and lists the files without changing anything.
      </p>
      <p>
        To rename or move a file, use <code>giga mv old new</code> rather than your file manager. That
        keeps the file’s identity, so its history continues and release requests treat it as the same part.
      </p>

      <h2 id="release-from-the-command-line">Release from the command line</h2>
      <Command>{`giga rr open --title "Gripper v2"
giga rr diff                     # what differs from main
giga rr picks --file picks.json  # optional
giga rr candidate
giga rr approve
giga rr release --notes "Stiffer jaw, new fingertip"`}</Command>
      <p>
        By default each changed file takes the branch’s copy. To choose differently, write a picks file.
        Files are named by path. <code>keep_main</code> leaves main’s copy, and a replacement ships a new
        part in place of an old one, keeping the old part’s identity:
      </p>
      <Command>{`{
  "actions": {
    "parts/jaw.SLDPRT": "take_branch",
    "parts/base.SLDPRT": "keep_main"
  },
  "replacements": [
    {
      "branchPath": "parts/finger_v2.SLDPRT",
      "mainPath": "parts/finger.SLDPRT"
    }
  ]
}`}</Command>
      <p>
        Changing picks discards the candidate, so run <code>giga rr candidate</code> again.{" "}
        <code>giga rr show</code> lists what still blocks the release, like missing approvals.
      </p>

      <h2 id="commands">Commands</h2>
      <h3>Account</h3>
      <CommandList
        commands={[
          ["giga login", "Sign in through your browser and save a device token."],
          ["giga whoami", "Show who you’re signed in as."],
          ["giga logout", "Revoke this computer’s token and forget it."],
        ]}
      />
      <h3>Projects and branches</h3>
      <CommandList
        commands={[
          ["giga project list", "Projects you’re a member of."],
          ["giga project create <slug>", <>Create a project you own. Private unless <code>--public</code>; set <code>--name</code> and <code>--description</code>.</>],
          ["giga project show [project]", "A project, its branches, and its latest release."],
          ["giga branch list", "Branches of a project."],
          ["giga branch create <name>", <>Start a branch from the latest release, or from <code>--from-release N</code>.</>],
        ]}
      />
      <h3>Workspace</h3>
      <CommandList
        commands={[
          ["giga clone <project> [folder]", <>Download a branch into a new folder. Choose it with <code>--branch</code>.</>],
          ["giga checkout", "Take the branch’s write lock for this computer, then pull its latest files."],
          ["giga pull", "Download the branch’s latest commit without losing local changes."],
          ["giga status", "Local changes, plus who has the branch checked out and whether you’re up to date."],
          ["giga mv <from> <to>", "Move or rename a file or folder, keeping each file’s identity."],
          ["giga commit -m <message>", <>Upload every changed file as a version. Name it with <code>--label</code>.</>],
          ["giga checkin", <>Give up the write lock. <code>--force</code> skips the uncommitted-changes check.</>],
        ]}
      />
      <h3>Release requests</h3>
      <p>
        Inside a workspace these act on the branch’s open request. Elsewhere, pass the request number, like{" "}
        <code>giga rr show 3</code>.
      </p>
      <CommandList
        commands={[
          ["giga rr open", <>Open a release request. Set <code>--title</code> and <code>--body</code>. The branch freezes until it’s released or closed.</>],
          ["giga rr list", <>Active release requests. <code>--all</code> includes released and closed ones.</>],
          ["giga rr show", "Status, candidate, approvals, and what blocks the release."],
          ["giga rr diff", "Every file changed on the branch or on main since the branch started."],
          ["giga rr picks --file <path>", <>Replace the picks with a JSON file, or <code>-</code> for standard input.</>],
          ["giga rr candidate", "Build the release candidate from the current picks."],
          ["giga rr rebuild-report --file <path>", "Attach the result of rebuilding the candidate in your CAD program."],
          ["giga rr approve", "Approve the current candidate."],
          ["giga rr unapprove", "Withdraw your approval."],
          ["giga rr release", <>Publish the approved candidate as the next release. Add <code>--notes</code>.</>],
          ["giga rr close", "Close without releasing. The branch unfreezes."],
        ]}
      />
      <h3>Releases</h3>
      <CommandList
        commands={[
          ["giga release list", "Releases, newest first."],
          ["giga release show <number>", "A release and its files."],
          ["giga release export <number> [folder]", "Download a release into a new folder, checking every file against its recorded hash."],
        ]}
      />

      <h2 id="scripting">Scripting</h2>
      <p>
        Add <code>--json</code> to any command for machine-readable output; errors then go to standard error
        as JSON. These environment variables change where <code>giga</code> connects and signs in:
      </p>
      <CommandList
        commands={[
          ["GIGA_TOKEN", "A device token to use instead of the saved sign-in. It’s never saved. Use it in CI."],
          ["GIGA_API_URL", <>A different API, for example a local one. Same as <code>--api-url</code>.</>],
          ["GIGA_CONFIG_DIR", "Where sign-ins are saved."],
        ]}
      />
    </>
  );
}

export const docs: DocSection[] = [
  {
    title: "Get started",
    pages: [
      {
        slug: "introduction",
        title: "Introduction",
        summary: "What GigaCAD is, who it’s for, and what you need to use it.",
        outline: ["What GigaCAD does", "Who it’s for", "What you need", "Where to go next"],
      },
      {
        slug: "concepts",
        title: "Concepts",
        summary: "Projects, branches, versions, and releases, and how they relate.",
        outline: ["Terms", "How they fit together", "Differences from Git"],
        body: Concepts,
      },
      {
        slug: "install-windows",
        title: "Install on Windows",
        summary: "Install the GigaCAD drive, tray app, and SolidWorks add-in, then sign in.",
        outline: ["Requirements", "Run the installer", "Sign in with a device code", "Find the drive in File Explorer", "Uninstall"],
      },
      {
        slug: "first-project",
        title: "Your first project",
        summary: "Create a project, upload an existing assembly, and make your first release.",
        outline: ["Create a project", "Add your files", "Make release v1", "Invite people"],
        body: FirstProject,
      },
    ],
  },
  {
    title: "Everyday work",
    pages: [
      {
        slug: "branches",
        title: "Branches",
        summary: "Start a branch from a release and see who is working on what.",
        outline: ["Start a branch", "The branches page", "Archive a branch"],
      },
      {
        slug: "check-out",
        title: "Check out and check in",
        summary: "Take and give back the exclusive write lock on a branch.",
        outline: ["Check out a branch", "What others see", "Check in", "Force-release a stale lock"],
      },
      {
        slug: "autosaves-and-versions",
        title: "Autosaves and versions",
        summary: "How saves become autosaves, and when to commit a version.",
        outline: ["Autosaves", "Commit a version", "When autosaves are cleared", "Restore an earlier version"],
      },
      {
        slug: "working-offline",
        title: "Working offline",
        summary: "Keep working on a checked-out branch without a connection.",
        outline: ["What works offline", "Reconnecting", "Resolving an upload that failed"],
      },
    ],
  },
  {
    title: "Releasing",
    pages: [
      {
        slug: "release-requests",
        title: "Release requests",
        summary: "Propose a branch for release and follow it through to a new version of main.",
        outline: ["Open a release request", "What freezing a branch means", "Close a release request"],
      },
      {
        slug: "picking-files",
        title: "Pick files",
        summary: "Choose, file by file, whether the release takes the branch’s copy or keeps main’s.",
        outline: ["Take branch or keep main", "Files changed on both sides", "Added and removed files", "Warnings"],
      },
      {
        slug: "replacing-parts",
        title: "Replace a part",
        summary: "Let a new part take over an existing part’s identity and history.",
        outline: ["When to replace a part", "How item identity works", "What happens to assemblies"],
      },
      {
        slug: "rebuilding-candidates",
        title: "Rebuild a release candidate",
        summary: "Rebuild assemblies in SolidWorks against the files you picked.",
        outline: ["Generate a candidate", "Rebuild in SolidWorks", "Read the rebuild report", "Fix a failed rebuild"],
      },
      {
        slug: "approvals",
        title: "Approvals",
        summary: "Who needs to sign off before a release, and when approvals reset.",
        outline: ["Approve a release request", "When approvals reset", "Release"],
      },
    ],
  },
  {
    title: "Projects and teams",
    pages: [
      {
        slug: "members-and-roles",
        title: "Members and roles",
        summary: "What owners, maintainers, contributors, and viewers can do.",
        outline: ["Roles", "Invite someone", "Change or remove a member"],
      },
      {
        slug: "approval-rules",
        title: "Approval rules",
        summary: "Set who approves releases, how many approvals are needed, and whether rebuilds must pass.",
        outline: ["Approvers", "Required approvals", "Approving your own release requests", "Requiring a clean rebuild"],
      },
      {
        slug: "public-projects",
        title: "Public projects and forks",
        summary: "Share a project with everyone and let people fork its releases.",
        outline: ["Make a project public", "Choose a license", "Fork a release", "Stars"],
      },
      {
        slug: "deleting-projects",
        title: "Delete a project",
        summary: "Delete a project and restore it within 30 days.",
        outline: ["Delete a project", "Restore a deleted project", "What’s kept and what isn’t"],
      },
    ],
  },
  {
    title: "SolidWorks",
    pages: [
      {
        slug: "solidworks-add-in",
        title: "The add-in",
        summary: "The GigaCAD task pane, and what the add-in does when you save and commit.",
        outline: ["The task pane", "Previews and references", "Turn the add-in on or off"],
      },
      {
        slug: "read-only-files",
        title: "Read-only files",
        summary: "Why a file opens read-only, and how to get write access.",
        outline: ["Releases and main", "Branches checked out by someone else", "Save a read-only file somewhere else"],
      },
      {
        slug: "references",
        title: "References and folder layout",
        summary: "How GigaCAD keeps assembly and drawing references intact.",
        outline: ["The drive’s folder layout", "Relative references", "Moving and renaming files"],
      },
    ],
  },
  {
    title: "Reference",
    pages: [
      {
        slug: "drive-layout",
        title: "Drive folders",
        summary: "Every folder the GigaCAD drive shows, and what you can do in each.",
        outline: ["main", "releases", "branches", "candidates", "Status icons"],
      },
      {
        slug: "ignored-files",
        title: "Ignored files",
        summary: "Temporary and backup files GigaCAD never uploads, and how to add your own rules.",
        outline: ["Built-in rules", "Add your own rules"],
        body: IgnoredFiles,
      },
      {
        slug: "cli",
        title: "Command-line tool",
        summary: "Work with GigaCAD from a terminal, and script it, with the giga command.",
        outline: ["Install", "Sign in", "Workspaces", "A typical session", "Release from the command line", "Commands", "Scripting"],
        body: Cli,
      },
      {
        slug: "troubleshooting",
        title: "Troubleshooting",
        summary: "Fixes for sync, sign-in, and rebuild problems.",
        outline: ["Files aren’t syncing", "The drive is missing from File Explorer", "The add-in doesn’t load", "Contact support"],
      },
    ],
  },
];

export const allPages = docs.flatMap((section) =>
  section.pages.map((page) => ({ ...page, section: section.title })),
);

export function findPage(slug: string) {
  const index = allPages.findIndex((p) => p.slug === slug);
  if (index === -1) return undefined;
  return { page: allPages[index]!, prev: allPages[index - 1], next: allPages[index + 1] };
}
