import { BranchDiagram } from "../../components/BranchDiagram";
import { DiffPickDemo } from "../../components/DiffPickDemo";
import { PartArt, type PartName } from "../../components/parts";
import {
  CheckIcon,
  DriveIcon,
  FolderIcon,
  LockIcon,
  SyncIcon,
  WindowsIcon,
} from "../../components/icons";
import { APP_URL } from "../../components/site";

const heroTiles: { part: PartName; className: string }[] = [
  { part: "gear", className: "tile-a" },
  { part: "bracket", className: "tile-b" },
  { part: "shaft", className: "tile-c" },
  { part: "nut", className: "tile-d" },
  { part: "spring", className: "tile-e" },
  { part: "plate", className: "tile-f" },
];

const steps = [
  { title: "Check out", body: "Take the branch. Everyone else sees it read-only until you check it in." },
  { title: "Save as usual", body: "Every save in SolidWorks becomes an autosave. No extra clicks." },
  { title: "Commit a version", body: "Name what changed. Earlier autosaves are cleared." },
  { title: "Open a release request", body: "Pick what ships and rebuild the assembly against it." },
  { title: "Release", body: "Once approved, the branch becomes the next locked version of main." },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-tiles" aria-hidden="true">
          {heroTiles.map((t) => (
            <div key={t.part} className={`tile ${t.className}`}>
              <PartArt part={t.part} className="tile-art" />
            </div>
          ))}
        </div>

        <div className="container hero-copy">
          <h1 className="display">
            Version control
            <br /> for the things
            <br /> you build.
          </h1>
          <p className="lead hero-lead">
            GigaCAD puts your SolidWorks projects in a drive in File Explorer. Work on a branch, save
            as usual, and release to main when the assembly rebuilds clean.
          </p>
          <a className="button button-large" href={`${APP_URL}/signup`}>
            Start a project
          </a>
          <a className="text-link hero-download" href="/download">
            <WindowsIcon className="icon" />
            Download the drive for Windows
          </a>
          <p className="hero-note">Works with SolidWorks on Windows. The macOS drive comes later.</p>
        </div>

        <div className="container hero-demo">
          <DiffPickDemo />
          <p className="demo-caption">
            This is a working release request. Change a pick and see what happens to the approvals.
          </p>
        </div>
      </section>

      <section className="section" id="how">
        <div className="container">
          <div className="section-intro">
            <h2 className="h2">Work on a branch. Release when it rebuilds.</h2>
            <p className="lead">
              Main is a series of releases that never change. Everything else happens on branches, one
              person at a time.
            </p>
          </div>
          <BranchDiagram />
          <ol className="steps">
            {steps.map((s, i) => (
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

      <div id="features">
        <section className="section feature">
          <div className="container feature-inner">
            <div className="feature-copy">
              <h2 className="h2">It’s a folder you already know how to use.</h2>
              <p className="body">
                Projects show up under GigaCAD in the File Explorer sidebar. Open an assembly from
                your branch folder and SolidWorks finds every reference, even offline. Releases and
                other people’s branches are there too, read-only.
              </p>
            </div>
            <div className="feature-visual">
              <div className="explorer">
                <div className="explorer-bar">
                  <span className="mono">GigaCAD › alex › rc-buggy › branches › suspension</span>
                </div>
                <div className="explorer-body">
                  <ul className="explorer-tree">
                    <li>
                      <DriveIcon className="icon" /> GigaCAD
                    </li>
                    <li className="indent-1">
                      <FolderIcon className="icon" /> rc-buggy
                    </li>
                    <li className="indent-2">
                      <LockIcon className="icon" /> main
                    </li>
                    <li className="indent-2">
                      <LockIcon className="icon" /> releases
                    </li>
                    <li className="indent-2">
                      <FolderIcon className="icon" /> branches
                    </li>
                    <li className="indent-3 is-active">
                      <FolderIcon className="icon" /> suspension
                    </li>
                    <li className="indent-3">
                      <LockIcon className="icon" /> battery-tray
                    </li>
                    <li className="indent-2">
                      <FolderIcon className="icon" /> candidates
                    </li>
                  </ul>
                  <table className="explorer-files">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="mono">rear_suspension.SLDASM</td>
                        <td className="status is-signal">
                          <span>
                            <CheckIcon className="icon" /> Synced
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="mono">rear_arm_L.SLDPRT</td>
                        <td className="status">
                          <span>
                            <SyncIcon className="icon" /> Uploading
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="mono">rear_arm_R.SLDPRT</td>
                        <td className="status is-signal">
                          <span>
                            <CheckIcon className="icon" /> Synced
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="mono">shock_long.SLDPRT</td>
                        <td className="status is-signal">
                          <span>
                            <CheckIcon className="icon" /> Synced
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="mono">chassis_plate.SLDPRT</td>
                        <td className="status is-signal">
                          <span>
                            <CheckIcon className="icon" /> Synced
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section feature is-flipped">
          <div className="container feature-inner">
            <div className="feature-copy">
              <h2 className="h2">One person edits a branch at a time.</h2>
              <p className="body">
                Checking out a branch gives you the only write access to it. Anyone else who opens
                those files gets them read-only, with a note saying who has them. Nobody overwrites
                anybody. Maintainers can take back a lock someone forgot about, and it’s logged.
              </p>
            </div>
            <div className="feature-visual">
              <div className="lock-stack">
                <div className="sw-banner" role="note">
                  <LockIcon className="icon" />
                  <p>
                    <strong>battery-tray is checked out by @sarah.</strong> This file opened read-only.
                  </p>
                </div>
                <ul className="branch-list">
                  <li>
                    <span className="mono">suspension</span>
                    <span className="badge badge-signal">Checked out by you</span>
                  </li>
                  <li>
                    <span className="mono">battery-tray</span>
                    <span className="badge">
                      <LockIcon className="icon" /> @sarah, 2h
                    </span>
                  </li>
                  <li>
                    <span className="mono">steering-rework</span>
                    <span className="badge badge-quiet">Checked in</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="section feature">
          <div className="container feature-inner">
            <div className="feature-copy">
              <h2 className="h2">Pick what ships, file by file.</h2>
              <p className="body">
                A release request lists every file that differs from main. Take the branch’s copy or
                keep main’s. If you remade a part under a new name, let it replace the old one: it
                keeps the old part’s history, and the assembly is rebuilt to use it.
              </p>
            </div>
            <div className="feature-visual">
              <div className="replace">
                <figure className="replace-part">
                  <PartArt part="spring" className="replace-art is-old" />
                  <figcaption>
                    <span className="mono">shock.SLDPRT</span>
                    <span>main, 9 versions</span>
                  </figcaption>
                </figure>
                <svg className="replace-arrow" viewBox="0 0 80 16" aria-hidden="true">
                  <path d="M2 8h74M68 2l8 6-8 6" />
                </svg>
                <figure className="replace-part">
                  <PartArt part="springLong" className="replace-art" />
                  <figcaption>
                    <span className="mono">shock_long.SLDPRT</span>
                    <span>continues the same history</span>
                  </figcaption>
                </figure>
              </div>
            </div>
          </div>
        </section>

        <section className="section feature is-flipped">
          <div className="container feature-inner">
            <div className="feature-copy">
              <h2 className="h2">Releases stay exactly as you shipped them.</h2>
              <p className="body">
                Every release is locked the moment it’s made. Nobody can edit or delete one, including
                the project owner. Choose who has to approve a release request, and how many of them.
              </p>
            </div>
            <div className="feature-visual">
              <ol className="releases" reversed>
                <li className="is-new">
                  <span className="mono release-tag">v8</span>
                  <span className="release-name">Longer-travel rear suspension</span>
                  <span className="release-meta">
                    <CheckIcon className="icon" /> 2 of 2 approved
                  </span>
                </li>
                <li>
                  <span className="mono release-tag">v7</span>
                  <span className="release-name">Battery tray moved forward</span>
                  <span className="release-meta">
                    <LockIcon className="icon" /> Locked
                  </span>
                </li>
                <li>
                  <span className="mono release-tag">v6</span>
                  <span className="release-name">Steel chassis plate</span>
                  <span className="release-meta">
                    <LockIcon className="icon" /> Locked
                  </span>
                </li>
                <li>
                  <span className="mono release-tag">v5</span>
                  <span className="release-name">First drivable build</span>
                  <span className="release-meta">
                    <LockIcon className="icon" /> Locked
                  </span>
                </li>
              </ol>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container extras">
            <div>
              <h3 className="h3">Autosaves clean up after themselves</h3>
              <p className="body">
                Every save is kept until you commit a version. Then the in-between saves are cleared,
                so storage holds what matters.
              </p>
            </div>
            <div>
              <h3 className="h3">Look before you download</h3>
              <p className="body">
                Each version has thumbnails and a 3D preview in the browser, so you can check a part
                without opening SolidWorks.
              </p>
            </div>
            <div>
              <h3 className="h3">Share a project, or keep it private</h3>
              <p className="body">
                Make a project public and anyone can browse its releases and fork one to start their
                own.
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="section closing">
        <div className="container closing-inner">
          <h2 className="h2">Put your next build under version control.</h2>
          <a className="button button-large" href={`${APP_URL}/signup`}>
            Start a project
          </a>
          <a className="text-link" href="/download">
            <WindowsIcon className="icon" />
            Download the drive for Windows
          </a>
        </div>
      </section>
    </>
  );
}
