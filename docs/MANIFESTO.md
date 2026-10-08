# Git and Scrum for hardware

*The GigaCAD manifesto*

Software teams got branches, pull requests, code review, and sprints. Those tools changed how fast software ships. Hardware teams got a shared drive, a folder full of `bracket_final_v3_REAL.SLDPRT`, and a Jira board that knows nothing about the files.

GigaCAD closes that gap. It takes what made software teams fast, changes it where hardware is different, and puts it in software an engineer understands without learning Git.

This document says why GigaCAD exists, what it believes, and how to make decisions when building it. Read it before [the docs](README.md). When a plan, a feature, or a pull request conflicts with this page, this page wins, or this page gets changed on purpose.

## Why GigaCAD exists

Hardware teams now move at software speed. A 3D printer turns a part around overnight. CNC time and PCBs are cheap. Startups, university and robotics teams, and small hardware companies design, build, test, and revise every week.

Their tools didn't keep up:

- **PDM and PLM systems** are expensive, slow to set up, and tied to one CAD vendor. They were built for large companies with change-control boards, not a team of six shipping a prototype on Friday.
- **Git** treats a CAD file as a blob. It can't merge two edits to the same part, so it can't stop two people from making them. It doesn't know that `motor-mount.SLDPRT` and `motor-mount-v2.SLDPRT` are the same part, or which parts an assembly needs.
- **Shared drives** have no history worth trusting. Someone saves over a teammate's work, someone else prints the wrong revision, and nobody can say which files made up the robot that worked last month.
- **Planning lives somewhere else.** The issue says "bracket cracks at the hole", but it links to nothing. The fix happens in a file the tracker has never heard of, and nobody can tell which release fixed it.

Software solved every one of these problems years ago. Hardware teams deserve the same answers, shaped for how hardware works.

## The goal

Give hardware teams software's best workflow, without asking engineers to become software engineers.

- **Git-style working trees.** Branches are real folders on your computer. You save as often as you like, name the versions that matter, and bring a branch back to main through a release request where you pick, file by file, what goes in.
- **Scrum, connected to the parts.** Issues, boards, and sprints that link to the actual parts, branches, and releases. Teams already on Jira keep it, and GigaCAD keeps both in sync.
- **A release is something you can build.** Bills of materials, drawings, and manufacturing packages come straight from a release.
- **Organizations for teams, and an open hub for everyone.** Teams get shared projects, roles, and billing. Anyone can publish a design for others to star, fork, and improve.

### How we measure it

**Iteration speed.** The time from an issue to a released, tested part keeps getting shorter.

Every feature should either shorten that loop or protect the work inside it. A feature that does neither waits.

## What we took from software, and how it changes for hardware

GigaCAD is not "Git for CAD". Copying software tools as they are fails, because CAD files can't be merged, parts have identities, and a physical build takes days, not seconds. Each idea below is borrowed on purpose and changed on purpose.

| Software | GigaCAD | Why it's different |
|---|---|---|
| Repository | **Project** | Same idea. Public or private |
| Branch, worktree | **Branch**, a real folder you **check out** | CAD files can't be merged, so one person and one machine hold a branch at a time. Everyone else sees it read-only |
| Commit | **Version** | A named, permanent point on a branch |
| Editor autosave | **Autosave** | Every save is kept until the next Version, then cleared. Saving is free; history stays readable |
| Pull request | **Release request** with **diff pick** | You don't merge; you pick, per file, what replaces main. A new part can **replace** an old one and take over its identity |
| Code review | **Approvals** | Per project: who approves, how many, and whether a clean rebuild is required |
| Line comments | Comments on faces and features of the 3D model and drawings *(planned)* | Reviewers point at the hole that's too close to the edge, not at a file name |
| CI build | **Candidate rebuild** in SolidWorks *(planned)* | The assembly is rebuilt against the picked parts before anyone approves it |
| Tag, release | **Release (vN)** | Permanent. Nobody can edit or delete it, including the owner |
| File path | **Item** | A part keeps its identity across renames and replacements, so its history never breaks |
| Issue and its branch | **Issue** linked to parts *(planned)* | Starting an issue creates its branch. The issue attaches to the parts it's about, so a part's history shows every problem found in it |
| Sprint | A hardware iteration ending in a release *(planned)* | Design, print or machine, test, revise. The sprint's output is a release you can build |
| Jira | Built-in tracker with two-way Jira sync *(planned)* | Teams already on Jira keep it. Releasing moves linked issues to Done and posts the release back |
| GitHub organizations | **Organizations** *(planned)* | Teams, roles, shared billing and storage, company sign-in, admin controls, public org pages |
| Open source, forks, stars | **Public projects, forks, stars** | Sharing designs is how hardware gets better in public |

## What we believe

**History is sacred.**
So releases are permanent. A database trigger rejects any change to one, and there's no route in the API to edit it. The only way to remove a release is to delete the whole project, and even that waits 30 days.

**One writer at a time.**
So branches are checked out, not merged. Locks are honest about what CAD files are. A stale lock can be force-released by an owner or maintainer, and the holder is told.

**Saves are cheap; versions are deliberate.**
So every save becomes an autosave, and a Version is a choice someone makes. Autosaves clear at the next Version, so history shows decisions, not noise.

**A release is a decision, not a merge.**
So a release request freezes the branch, shows every file that differs from the latest main, warns about conflicts and broken assemblies, and waits for the project's approvals. Any change to the candidate resets them.

**Parts have identity.**
So every file is an item that survives renames and replacements. Issues will attach to items too, so a part carries its own story.

**The plan and the parts live together.**
So the path is one line: issue, branch, release request, release. Each release will list the issues it shipped, and each issue will point at the parts it changed.

**Speed comes from short loops.**
So we favor small branches, one per issue, fast previews and diffs, and approvals that take minutes. Waiting is the most expensive thing in hardware after scrap.

**Light enough for one person, strong enough for an org.**
So a solo project can approve its own release requests, and a team can require two approvers and a clean rebuild. Scrum is there for teams that want it, never forced on anyone.

**Meet engineers where they work.**
So projects are folders in Finder and File Explorer, the CAD add-in brings locks and versions into SolidWorks, the `giga` CLI covers everything else, and Jira users stay in Jira. The website is one door, not the only one.

**Intuitive over clever.**
So we use plain words: check out, Version, Release request. An engineer should never need to know what a rebase is.

**Agents are teammates.**
So everything a person can do in the app, an AI agent can do through the API and the CLI: check out, commit, open a release request, work an issue. Agents follow the same locks, roles, and approvals as people. No back doors.

**A CAD-agnostic core, deep integrations on top.**
So any file is versioned, previewed where possible, and released. SolidWorks gets the extras first: references, rebuilds, and exports. Other CAD programs follow.

**Your work is yours.**
So projects start private, and organization projects will too. Public is a choice you make. Any release downloads byte for byte, in the CAD program's own formats.

**Trust is earned by a record.**
So check-outs, force-releases, approvals, and releases are written to the project's event log. Teams can see who did what, and when.

**Sharing is a choice, and a good one.**
So public projects, profiles, stars, and forks are first-class. A design someone chooses to open should be easy to find, fork, and build on.

## The framework

The whole model in one picture. Pieces marked *planned* don't exist yet.

```
Organization (planned)
 └─ Teams and roles (planned)
     └─ Project ─────────────── Root files (their own Revisions)
         │
         ├─ Backlog, board, sprints (planned)
         │   └─ Issue ──────────── linked to items (parts) (planned)
         │        │
         │        ▼  starting an issue creates its branch (planned)
         ├─ Branch  ── checked out by one person, on one machine
         │   ├─ Autosaves  (temporary)
         │   └─ Versions   (permanent)
         │        │
         │        ▼
         ├─ Release request ── freezes the branch, links its issues (planned)
         │   ├─ Diff pick: take branch, keep main, replace, remove, keep
         │   ├─ Release candidate ── rebuilt in SolidWorks (planned)
         │   └─ Approvals
         │        │
         │        ▼
         └─ Release vN ── permanent
              ├─ issues move to Done, Jira updated (planned)
              └─ BOMs, drawings, manufacturing packages (planned)
```

The exact meaning of every word is in [the product docs](product/README.md#words). Use those words everywhere: in the app, the docs, and the code.

## How it's built, and why

The architecture follows from the beliefs. Details are in [the docs](README.md#how-the-pieces-fit).

- **The API is the only writer.** The website, the CLI, the desktop app, the CAD add-in, agents, and integrations like Jira all go through `apps/api`. One writer means one place to enforce locks, roles, approvals, and permanence.
- **File bytes never pass through the API.** Clients hash files, ask which ones the server lacks, and upload straight to storage. Every file is stored once. Large CAD files stay fast.
- **Rules live in one place.** Diffs, release candidates, approvals, autosave pruning, ignore rules, and paths live in `packages/core`, shared by every app. A rule that lives anywhere else will drift.
- **Live everywhere.** Locks, release requests, and approvals update live in every client, so nobody works from a stale view.

## What we say no to

- **Editing or deleting releases.** Not for owners, not for admins, not "just this once".
- **Merging CAD files.** We lock instead. A tool that pretends to merge binaries loses work.
- **Ceremony for its own sake.** No required story points, estimates, or rituals. Scrum is a tool a team picks up, not a rulebook.
- **Planning cut off from the files.** An issue, sprint, or board that can't point at real parts is a to-do list, and the world has enough of those.
- **Becoming a CAD program.** We version, review, and release designs. Engineers design in their own tools.
- **One CAD vendor.** SolidWorks comes first, not only.
- **Enterprise bloat before the team loop is great.** No ERP, no change-order bureaucracy, no 40-field forms until a six-person team loves the core loop.
- **Claims we can't back up.** No fake testimonials, user counts, or features described as shipped before they are.

## How to decide

For anyone building GigaCAD, people and agents alike. When a choice is unclear, go down this list.

1. **Protect history first.** If a change could lose or rewrite someone's work, it's wrong, however convenient it is.
2. **Does it make the issue-to-release loop faster?** If not, and it doesn't protect the work in that loop, why build it?
3. **Anything a person can do, an agent can do** through the API, with the same permissions. If a feature only works by clicking, it isn't finished.
4. **If software solved it, adapt that solution.** Change it only where hardware differs: files that can't merge, physical lead times, part identity. Don't invent a new workflow when a proven one fits.
5. **When teams and solo users conflict, the team wins,** and it must still work for one person.
6. **Every planning object links to real files.** Issues, sprints, and releases point at parts.
7. **Prefer the engineer's own tools over a new screen.** A folder, a right-click, or a CAD add-in panel beats another web page.
8. **A rule goes in `packages/core` or nowhere.**
9. **Use the product's exact words.** "Check out" is the verb, "Checked out" is the state, and a release request is never a pull request.
10. **Don't claim it until it ships.** Mark planned things as planned.

## Where we're going

Direction, not dates. The live to-do list is [the roadmap](product/roadmap.md).

1. **Windows and the SolidWorks add-in.** Locks, versions, and references inside SolidWorks, and release candidates rebuilt before approval.
2. **Organizations.** Teams and roles, teams as approvers, shared billing and storage, company sign-in, admin controls, and public org pages.
3. **Issues, boards, and sprints.** A branch per issue, issues linked to parts, and releases that close the issues they shipped.
4. **Two-way Jira sync** for teams that already plan in Jira.
5. **Review on the model.** Comments on faces, features, and drawings inside a release request.
6. **Releases you can build from.** Bills of materials, drawings, and manufacturing packages generated from a release.
7. **Other CAD programs.** Fusion, FreeCAD, and Onshape.
8. **The open hardware hub.** A place where public designs are found, forked, improved, and built.
9. **Electronics.** KiCad and Altium projects versioned and released next to the mechanical parts.
10. **An on-demand drive** that shows every file and downloads only what you open.

The API and CLI stay agent-friendly at every step.

---

Hardware should move as fast as the people building it. GigaCAD exists to make that the normal way to work.
