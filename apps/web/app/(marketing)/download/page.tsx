import type { Metadata } from "next";
import Link from "next/link";
import { FolderIcon, WindowsIcon } from "../../../components/icons";
import { APP_URL, DOWNLOAD_URL } from "../../../components/site";

export const metadata: Metadata = {
  title: "Download GigaCAD for Windows",
  description:
    "Install the GigaCAD drive, tray app, and SolidWorks add-in. Windows 10 or 11, 64-bit.",
};

const menu = [
  { label: "Check Out" },
  { label: "Check In", disabled: true },
  { label: "Commit Version…" },
  { divider: true },
  { label: "New Branch…" },
  { label: "Open Release Request" },
  { label: "History" },
  { divider: true },
  { label: "Open on gigacad.site" },
] as const;

const setup = [
  {
    title: "Run the installer",
    body: "It adds GigaCAD to the File Explorer sidebar, starts the tray app, and registers the add-in with SolidWorks.",
  },
  {
    title: "Sign in",
    body: "The tray app shows a short code. Approve it at app.gigacad.site/device and your projects appear in the drive.",
  },
  {
    title: "Check out a branch",
    body: "Right-click a branch folder and choose Check Out. The whole branch downloads, so SolidWorks can find every reference offline.",
  },
  {
    title: "Open it in SolidWorks",
    body: "Work and save the way you always do. Each save becomes an autosave until you commit a version.",
  },
];

const requirements = [
  ["Windows", "Windows 10 version 1709 or later, or Windows 11. 64-bit only."],
  ["SolidWorks", "Needed only for the add-in. Every other file type syncs without it."],
  ["Disk space", "Enough for the branches you check out. Everything else stays in the cloud until you open it."],
  ["Network", "Needed to sync. A checked-out branch keeps working offline and uploads when you reconnect."],
];

export default function DownloadPage() {
  return (
    <>
      <section className="page-head">
        <div className="hero-grid" aria-hidden="true" />
        <div className="container page-head-inner download-head">
          <div className="page-head-copy">
            <h1 className="page-title">Download GigaCAD for Windows.</h1>
            <p className="lead">
              One installer sets up the GigaCAD drive in File Explorer, a tray app for signing in and
              committing, and the SolidWorks add-in.
            </p>
            <div className="download-actions">
              <a className="button button-large" href={DOWNLOAD_URL}>
                <WindowsIcon className="icon" />
                Download for Windows
              </a>
              <p className="download-meta">64-bit installer for Windows 10 and 11</p>
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
          <h2 className="h2 section-title">What the installer adds</h2>
          <div className="extras">
            <div>
              <h3 className="h3">The GigaCAD drive</h3>
              <p className="body">
                Your projects as folders in File Explorer: main, every release, branches, and release
                candidates. Files you can’t edit are marked read-only.
              </p>
            </div>
            <div>
              <h3 className="h3">The tray app</h3>
              <p className="body">
                Sign in, see what’s syncing, and commit a version with a message. Checking out and in
                also works from the right-click menu.
              </p>
            </div>
            <div>
              <h3 className="h3">The SolidWorks add-in</h3>
              <p className="body">
                A task pane showing who has the branch checked out. It also sends previews and references
                with each version and rebuilds release candidates.
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
            <h2 className="h3">On a Mac?</h2>
            <p className="body">
              A macOS drive is planned after Windows. Until then you can browse projects, 3D previews, and
              release requests in the browser on any computer.
            </p>
            <div className="other-platforms-links">
              <a className="text-link" href={APP_URL}>
                Open GigaCAD in your browser
              </a>
              <Link className="text-link" href="/docs/install-windows">
                Read the install guide
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
