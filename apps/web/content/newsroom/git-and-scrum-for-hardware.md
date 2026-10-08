---
title: Git and Scrum for hardware
summary: Software teams got branches, pull requests, and sprints. Hardware teams got a shared drive. Here's why GigaCAD exists, and what it believes.
kind: essay
date: 2026-10-08
author: Joshua Tarara
order: 2
---

Software teams got branches, pull requests, code review, and sprints. Those tools changed how fast software ships. Hardware teams got a shared drive, a folder full of `bracket_final_v3_REAL.SLDPRT`, and a Jira board that knows nothing about the files.

GigaCAD closes that gap. It takes what made software teams fast, changes it where hardware is different, and puts it in software an engineer understands without learning Git.

## Why GigaCAD exists

Hardware teams now move at software speed. A 3D printer turns a part around overnight. CNC time and PCBs are cheap. Startups, university and robotics teams, and small hardware companies design, build, test, and revise every week.

Their tools didn't keep up:

- **PDM and PLM systems** are expensive, slow to set up, and tied to one CAD vendor. They were built for large companies with change-control boards, not a team of six shipping a prototype on Friday.
- **Git** treats a CAD file as a blob. It can't merge two edits to the same part, so it can't stop two people from making them. It doesn't know that `motor-mount.SLDPRT` and `motor-mount-v2.SLDPRT` are the same part, or which parts an assembly needs.
- **Shared drives** have no history worth trusting. Someone saves over a teammate's work, someone else prints the wrong revision, and nobody can say which files made up the robot that worked last month.
- **Planning lives somewhere else.** The issue says "bracket cracks at the hole", but it links to nothing. The fix happens in a file the tracker has never heard of, and nobody can tell which release fixed it.

Software solved every one of these problems years ago. Hardware teams deserve the same answers, shaped for how hardware works.

## What we took from software, and how it changes

GigaCAD is not "Git for CAD". Copying software tools as they are fails, because CAD files can't be merged, parts have identities, and a physical build takes days, not seconds. Each idea below is borrowed on purpose and changed on purpose.

| Software | GigaCAD | Why it's different |
|---|---|---|
| Repository | **Project** | Same idea. Public or private |
| Branch | **Branch**, a real folder you **check out** | CAD files can't be merged, so one person holds a branch at a time. Everyone else sees it read-only |
| Commit | **Version** | A named, permanent point on a branch |
| Editor autosave | **Autosave** | Every save is kept until the next Version, then cleared |
| Pull request | **Release request** with **diff pick** | You don't merge; you pick, per file, what replaces main. A new part can replace an old one and take over its identity |
| Code review | **Approvals** | Per project: who approves, and how many |
| Tag, release | **Release (vN)** | Permanent. Nobody can edit or delete it, including the owner |
| CI build | **Candidate rebuild** in SolidWorks *(planned)* | The assembly is rebuilt against the picked parts before anyone approves it |
| Issues and sprints | **Issues** linked to parts *(planned)* | Starting an issue creates its branch, and a part's history shows every problem found in it |

## What we believe

**History is sacred.** Releases are permanent. Nobody can edit one, and there's no button to try.

**One writer at a time.** Branches are checked out, not merged. Locks are honest about what CAD files are.

**Saves are cheap; versions are deliberate.** Every save becomes an autosave, and a Version is a choice someone makes. History shows decisions, not noise.

**A release is a decision, not a merge.** A release request freezes the branch, shows every file that differs from main, and waits for the project's approvals. Any change to the picks resets them.

**Parts have identity.** Every file keeps its identity across renames and replacements, so a part's history never breaks.

**Meet engineers where they work.** Projects belong in Finder and File Explorer, and locks and versions belong inside the CAD program. The website is one door, not the only one.

**Your work is yours.** Projects start private. Public is a choice you make, and any release downloads byte for byte.

## How we measure it

**Iteration speed.** The time from an issue to a released, tested part should keep getting shorter. Every feature should either shorten that loop or protect the work inside it.

## What we say no to

- **Editing or deleting releases.** Not for owners, not for admins, not "just this once".
- **Merging CAD files.** We lock instead. A tool that pretends to merge binaries loses work.
- **Ceremony for its own sake.** Scrum is a tool a team picks up, not a rulebook.
- **Becoming a CAD program.** We version, review, and release designs. Engineers design in their own tools.
- **Claims we can't back up.** No fake testimonials, and nothing described as shipped before it is.

---

Hardware should move as fast as the people building it. GigaCAD exists to make that the normal way to work.
