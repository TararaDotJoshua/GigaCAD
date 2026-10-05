import type { Metadata } from "next";
import Link from "next/link";
import { AppleIcon, FolderIcon, WindowsIcon } from "../../../components/icons";
import { APP_URL, DOWNLOAD_URL, MAC_DOWNLOAD_URL } from "../../../components/site";

export const metadata: Metadata = {
  title: "Download GigaCAD for Windows and Mac",
  description:
    "Install GigaCAD on Windows 10 or 11, or on macOS 13 or later: your projects as folders, with check out, commit, and check in a right-click away.",
};

const menu = [
  { label: "Check Out" },
  { label: "Check In", disabled: true },
  { label: "Commit Version…" },
  { label: "Pull Latest" },
  { divider: true },
  { label: "Download" },
  { label: "Copy Link" },
  { label: "Open on gigacad.site" },
] as const;

const setup = [
  {
    title: "Run the installer",
    body: "It installs for you alone, no administrator needed, and opens GigaCAD. The installer isn’t code-signed yet, so if Windows warns, choose More info, then Run anyway.",
  },
  {
    title: "Sign in",
    body: "GigaCAD shows a short code and opens your browser. Approve it and your projects appear in the GigaCAD folder.",
  },
  {
    title: "Check out a branch",
    body: "Right-click a branch folder and choose GigaCAD → Check Out. The whole branch downloads, so SolidWorks can find every reference offline.",
  },
  {
    title: "Open it in SolidWorks",
    body: "Work and save the way you always do. Each save becomes an autosave until you commit a version.",
  },
];

const requirements = [
  ["Windows", "Windows 10 version 1809 or later, or Windows 11. 64-bit only."],
  ["SolidWorks", "Not required. GigaCAD versions any file; SolidWorks files get previews and references once the add-in ships."],
  ["Disk space", "Enough for the branches and releases you download. The rest stay as empty folders until you download them."],
  ["Network", "Needed to sync. A checked-out branch keeps working offline and uploads when you reconnect."],
];

export default function DownloadPage() {
  return (
    <>
      <section className="page-head">
        <div className="hero-grid" aria-hidden="true" />
        <div className="container page-head-inner download-head">
          <div className="page-head-copy">
            <h1 className="page-title">Download GigaCAD.</h1>
            <p className="lead">
              Your projects as folders in File Explorer or Finder. Check out, commit, and check in from the
              right-click menu, and each save becomes an autosave.
            </p>
            <div className="download-actions">
              <a className="button button-large" href={DOWNLOAD_URL}>
                <WindowsIcon className="icon" />
                Download for Windows
              </a>
              <p className="download-meta">
                64-bit installer for Windows 10 and 11. <Link href="/docs/install-windows">Install guide</Link>
              </p>
              <a className="text-link" href={MAC_DOWNLOAD_URL}>
                <AppleIcon className="icon" />
                Download for Mac
              </a>
              <p className="download-meta">
                macOS 13 or later, Intel and Apple silicon. <a href="#mac">First-time setup</a>
              </p>
            </div>
          </div>

          <div className="context-demo" aria-hidden="true">
            <div className="context-folder">
              <FolderIcon className="icon" />
              <span className="mono">suspension</span>
            </div>
            <ul className="context-menu">
              {menu.map((item, i) =>
                "divider" in item ? (
                  <li key={i} className="context-divider" />
                ) : (
                  <li
                    key={item.label}
                    className={
                      "disabled" in item ? "is-disabled" : i === 0 ? "is-hover" : undefined
                    }
                  >
                    {item.label}
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2 className="h2 section-title">What you get</h2>
          <div className="extras">
            <div>
              <h3 className="h3">The GigaCAD folder</h3>
              <p className="body">
                Your projects as folders, laid out like the web: root files, branches, and releases. Branches
                you haven’t checked out, and every release, are read-only.
              </p>
            </div>
            <div>
              <h3 className="h3">The app</h3>
              <p className="body">
                Sign in, see what’s syncing, and commit a version with a message. Check Out, Commit Version,
                and Check In are also in the right-click menu.
              </p>
            </div>
            <div>
              <h3 className="h3">The SolidWorks add-in, next</h3>
              <p className="body">
                Coming to Windows: a task pane showing who has the branch checked out, previews and references
                sent with each version, and rebuilt release candidates.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2 className="h2 section-title">Set up in four steps</h2>
          <ol className="steps steps-four">
            {setup.map((s, i) => (
              <li key={s.title}>
                <span className="step-number" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="container feature-inner is-top">
          <div className="feature-copy">
            <h2 className="h2">System requirements</h2>
            <p className="body">
              GigaCAD runs alongside SolidWorks and doesn’t change how it opens or saves files.
            </p>
          </div>
          <dl className="spec-table">
            {requirements.map(([term, detail]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="section closing">
        <div className="container">
          <div className="other-platforms">
            <h2 className="h3" id="mac">On a Mac?</h2>
            <p className="body">
              GigaCAD for macOS puts your projects in a GigaCAD folder in Finder, with Check Out, Commit
              Version, and Check In in the right-click menu. It runs on macOS 13 or later, Intel or Apple
              silicon. It isn’t notarized by Apple yet, so the first time, open it from System Settings →
              Privacy &amp; Security → Open Anyway.
            </p>
            <div className="other-platforms-links">
              <a className="text-link" href={MAC_DOWNLOAD_URL}>
                Download for Mac
              </a>
              <Link className="text-link" href="/docs/install-mac">
                Read the Mac install guide
              </Link>
              <a className="text-link" href={APP_URL}>
                Open GigaCAD in your browser
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
