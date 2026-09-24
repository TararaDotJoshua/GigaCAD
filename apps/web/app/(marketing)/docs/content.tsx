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
      },
      {
        slug: "cli",
        title: "Command-line tool",
        summary: "Script GigaCAD with the giga command.",
        outline: ["Install", "Sign in", "Commands"],
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
