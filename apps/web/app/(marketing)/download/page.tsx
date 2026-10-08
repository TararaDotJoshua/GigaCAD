import type { Metadata } from "next";
import Link from "next/link";
import { FolderIcon } from "../../../components/icons";
import { APP_URL } from "../../../components/site";

export const metadata: Metadata = {
  title: "GigaCAD for Windows and Mac",
  description:
    "The GigaCAD desktop apps for Windows and Mac are in development. Until they're ready, use GigaCAD in your browser or from the command line.",
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

export default function DownloadPage() {
  return (
    <>
      <section className="page-head">
        <div className="hero-grid" aria-hidden="true" />
        <div className="container page-head-inner download-head">
          <div className="page-head-copy">
            <h1 className="page-title">Desktop apps, coming soon.</h1>
            <p className="lead">
              We’re building GigaCAD for Windows and Mac: your projects as folders in File Explorer or
              Finder, with check out, commit, and check in in the right-click menu. They aren’t ready to
              download yet.
            </p>
            <div className="download-actions">
              <a className="button button-large" href={`${APP_URL}/signup`}>
                Start a project
              </a>
              <p className="download-meta">
                Use GigaCAD in your browser or with the <Link href="/docs/cli">command-line tool</Link> today.
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
          <h2 className="h2 section-title">What’s coming</h2>
          <div className="extras">
            <div>
              <h3 className="h3">The GigaCAD folder</h3>
              <p className="body">
                Your projects as folders, laid out like the web: root files, branches, and releases. Branches
                you haven’t checked out, and every release, will be read-only.
              </p>
            </div>
            <div>
              <h3 className="h3">The app</h3>
              <p className="body">
                Sign in, see what’s syncing, and commit a version with a message. Check Out, Commit Version,
                and Check In will also be in the right-click menu.
              </p>
            </div>
            <div>
              <h3 className="h3">The SolidWorks add-in</h3>
              <p className="body">
                On Windows: a task pane showing who has the branch checked out, previews and references
                sent with each version, and rebuilt release candidates.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section closing">
        <div className="container">
          <div className="other-platforms">
            <h2 className="h3">Use GigaCAD today</h2>
            <p className="body">
              Projects, branches, versions, release requests, and releases already work in the browser and
              from the <code>giga</code> command-line tool. Your projects will be waiting in the GigaCAD folder
              when the apps ship.
            </p>
            <div className="other-platforms-links">
              <a className="text-link" href={APP_URL}>
                Open GigaCAD in your browser
              </a>
              <Link className="text-link" href="/docs/cli">
                Read the command-line docs
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
