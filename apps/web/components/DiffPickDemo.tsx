"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { PartArt, type PartName } from "./parts";
import { AlertIcon, BranchIcon, CheckIcon, LockIcon, SearchIcon } from "./icons";

interface FileRow {
  name: string;
  part: PartName;
  note: string;
  caution?: boolean;
  options: [string, string];
  initial: 0 | 1;
}

const FILES: FileRow[] = [
  {
    name: "rear_suspension.SLDASM",
    part: "assembly",
    note: "Changed on both sides",
    caution: true,
    options: ["Take branch", "Keep main"],
    initial: 0,
  },
  {
    name: "rear_arm_L.SLDPRT",
    part: "arm",
    note: "Changed on branch",
    options: ["Take branch", "Keep main"],
    initial: 0,
  },
  {
    name: "chassis_plate.SLDPRT",
    part: "plate",
    note: "Changed on main in v7",
    options: ["Take branch", "Keep main"],
    initial: 1,
  },
  {
    name: "shock_long.SLDPRT",
    part: "spring",
    note: "New on branch",
    options: ["Replace shock.SLDPRT", "Add as new"],
    initial: 0,
  },
];

type Rebuild = "passed" | "stale" | "running";

/**
 * A working copy of the release request screen. Changing a pick changes the
 * candidate, which resets approvals and requires a new rebuild, as in the app.
 */
export function DiffPickDemo() {
  const [picks, setPicks] = useState(() => FILES.map((f) => f.initial));
  const [rebuild, setRebuild] = useState<Rebuild>("passed");
  const [approved, setApproved] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function pick(row: number, option: 0 | 1) {
    if (picks[row] === option) return;
    setPicks((p) => p.map((v, i) => (i === row ? option : v)));
    window.clearTimeout(timer.current);
    setRebuild("stale");
    setApproved(false);
  }

  function runRebuild() {
    setRebuild("running");
    timer.current = window.setTimeout(() => setRebuild("passed"), 1400);
  }

  const approvals = approved ? 1 : 0;

  return (
    <section className="app-window" aria-label="Release request demo">
      <aside className="app-sidebar">
        <Logo />
        <div className="app-search">
          <SearchIcon className="icon" />
          Search
        </div>
        <p className="app-sidebar-heading">Projects</p>
        <ul className="app-nav">
          <li className="is-active">rc-buggy</li>
          <li className="app-nav-branch">
            <LockIcon className="icon" />
            main <span className="mono">v7</span>
          </li>
          <li className="app-nav-branch">
            <BranchIcon className="icon" />
            suspension
            <span className="dot dot-signal" aria-label="checked out by you" />
          </li>
          <li className="app-nav-branch">
            <BranchIcon className="icon" />
            battery-tray
            <span className="app-nav-holder">@sarah</span>
          </li>
          <li>desk-lamp</li>
          <li>printer-enclosure</li>
        </ul>
      </aside>

      <div className="app-main">
        <p className="app-crumbs">rc-buggy / Release requests / #12</p>
        <h3 className="app-title">Longer-travel rear suspension</h3>
        <p className="app-meta">
          <span className="badge badge-open">Open</span>
          <span className="mono">suspension</span> into <span className="mono">main v7</span>
        </p>

        <div className="pick-table">
          <div className="pick-head">
            <span>File</span>
            <span>Pick</span>
          </div>
          {FILES.map((f, row) => (
            <div className="pick-row" key={f.name}>
              <div className="pick-file">
                <PartArt part={f.part} className="pick-thumb" strokeWidth={1.2} />
                <div>
                  <p className="mono pick-name">{f.name}</p>
                  <p className={f.caution ? "pick-note is-caution" : "pick-note"}>
                    {f.caution && <AlertIcon className="icon" />}
                    {f.note}
                  </p>
                </div>
              </div>
              <fieldset className="segmented">
                <legend className="sr-only">Pick for {f.name}</legend>
                {f.options.map((label, option) => (
                  <label key={label} className="segment">
                    <input
                      type="radio"
                      name={`pick-${row}`}
                      checked={picks[row] === option}
                      onChange={() => pick(row, option as 0 | 1)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            </div>
          ))}
        </div>
      </div>

      <div className="app-rail">
        <section className="rail-card" aria-live="polite">
          <h4>Rebuild</h4>
          {rebuild === "passed" && (
            <p className="rail-status is-signal">
              <CheckIcon className="icon" /> Rebuild passed
            </p>
          )}
          {rebuild === "running" && <p className="rail-status">Rebuilding in SolidWorks…</p>}
          {rebuild === "stale" && (
            <p className="rail-status is-caution">
              <AlertIcon className="icon" /> Candidate changed
            </p>
          )}
          <p className="rail-detail">
            {rebuild === "stale"
              ? "Rebuild the candidate so the assembly loads the parts you picked."
              : "0 rebuild errors, 0 mate errors in rear_suspension.SLDASM."}
          </p>
          {rebuild !== "passed" && (
            <button className="rail-button" onClick={runRebuild} disabled={rebuild === "running"}>
              Rebuild candidate
            </button>
          )}
        </section>

        <section className="rail-card" aria-live="polite">
          <h4>
            Approvals <span className="rail-count">{approvals} of 2</span>
          </h4>
          <ul className="approvers">
            <li>
              <span className="avatar">A</span> @alex
              <span className={approved ? "approver-state is-signal" : "approver-state"}>
                {approved ? "Approved" : "Reset"}
              </span>
            </li>
            <li>
              <span className="avatar">S</span> @sarah
              <span className="approver-state">Waiting</span>
            </li>
          </ul>
          {!approved && <p className="rail-detail">Approvals reset because the candidate changed.</p>}
          <button className="rail-button is-primary" disabled>
            Release v8
          </button>
        </section>
      </div>
    </section>
  );
}
