# Product

What GigaCAD is, the words it uses, and the rules every part of the code follows. [plan.md](plan.md) is the full design, with the data model, API, phases, and verification plan. [roadmap.md](roadmap.md) is the live to-do list.

## Who it's for

Hobbyists and enthusiasts who want version control for CAD files without paying for SolidWorks PDM or fighting Git over binary files. It's a hosted service with public sharing and forks. SolidWorks comes first. Other file types are fully versioned; they just miss the SolidWorks extras.

## Words

Use these exact words in the UI, docs, and code.

| Term | Meaning |
|---|---|
| Project | A repo. Public or private |
| Release (vN) | An immutable version of main. A database trigger rejects any UPDATE or DELETE |
| Branch | Work forked from a release |
| Check out / Check in | Take or give up the exclusive write lock on a branch. One user and one machine at a time |
| Version | A named, permanent commit on a branch |
| Autosave | A temporary snapshot of a save. Deleted at the branch's next Version or release |
| Release request | A proposal to release a branch. Opening one freezes the branch |
| Diff pick | Per file: take branch, keep main, replace main item X with branch file Y, remove, or keep |
| Release candidate | The picked file set, rebuilt in SolidWorks (planned) and then approved |
| Item | A stable file identity across releases and renames. A "replace" pick makes the new file inherit the old item ID |
| Root files | Files and folders at the project root, with their own "Revisions", outside the branch and release flow |
| Tags | Labels on files. Not releases |

## Workflow rules

1. **Main is permanently locked.** Releases can't be edited or deleted. Deleting the whole project is the only way to remove one, and it's a soft delete with 30 days to restore.
2. **Check-out locks.** Only the holder can write to a branch. Everyone else sees it read-only. Owners and maintainers can force-release a stale lock; it's logged and the holder is told.
3. **Autosaves** are cleared when the next Version is committed or the branch is released. Blobs nothing else uses are then cleaned up.
4. **Release requests** freeze the branch until they're released or closed.
5. **Diff pick** lists every file that differs between the branch and the latest main. It warns about files changed on both sides and assemblies whose parts are missing or came from the other side.
6. **Part replacement.** A branch file that replaces a main file inherits its item ID, so the part's history continues.
7. **Candidate rebuild** (planned, in the SolidWorks add-in) repoints references, rebuilds, and attaches a report.
8. **Approvals** are set per project: an approver list (people and roles), a required count, whether requesters can approve their own request, and whether a clean rebuild is required. Any change to the candidate resets approvals.

## Where the rules live in code

`packages/core/src`, shared by the API, web app, CLI, and desktop app:

| File | Rule |
|---|---|
| `manifest.ts` | Diffs two file lists (manifests) |
| `candidate.ts` | Builds a release candidate from picks, including item-ID inheritance on replace |
| `approvals.ts` | Decides whether a request has enough valid approvals |
| `autosave.ts` | Picks which autosaves to prune |
| `ignore.ts` | Files never versioned: SolidWorks temp and backup files, macOS `Icon\r` and AppleDouble files |
| `paths.ts` | Windows-safe, case-insensitive project paths and reserved root names (`Branches`, `Releases`) |
| `plans.ts` | The paid plans and storage limits ([payments/](../payments/README.md)) |
| `handles.ts` | Handle rules and reserved handles (site paths like `docs`, `explore`) |
| `contributions.ts` | The profile page's contribution graph |

## Decisions the owner confirmed

- Hosted cloud service with public sharing and forks. Starting with SolidWorks, so Windows comes first.
- Storage-only pricing, with every feature and unlimited collaborators on every plan ([payments/](../payments/README.md)).
- Web UX decisions from 2026-09-30, listed in [web-ux-plan.md](../ui/web-ux-plan.md#decisions).
- Handle-rename redirects and organizations were left out on purpose.

Still open: see [roadmap.md](roadmap.md#open-product-questions).
