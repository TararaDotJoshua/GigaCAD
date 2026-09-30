import { describe, expect, it } from 'vitest';
import { conflictName, isEmptyPlan, pendingRootChanges, planRootSync, type RootSnapshot } from '../src/rootSync.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id(1);
const B = id(2);
const DOCS = id(10);
const REF = id(11);

/** Last-synced state: README.md, Docs/, Docs/Guide.pdf. */
const base: RootSnapshot = {
  files: [
    { entryId: A, path: 'README.md', blob: 'readme-1' },
    { entryId: B, path: 'Docs/Guide.pdf', blob: 'guide-1' },
  ],
  folders: [{ entryId: DOCS, path: 'Docs' }],
};
const unchangedLocal = { files: base.files.map(({ path, blob }) => ({ path, blob })), folders: ['Docs'] };

describe('planRootSync', () => {
  it('does nothing when everything matches', () => {
    expect(isEmptyPlan(planRootSync(base, unchangedLocal, base))).toBe(true);
  });

  it('downloads everything into an empty folder, folders first', () => {
    const plan = planRootSync({ files: [], folders: [] }, { files: [], folders: [] }, base);
    expect(plan.localFolders).toEqual(['Docs']);
    expect(plan.downloads).toEqual(base.files.map(({ path, blob }) => ({ path, blob })));
    expect(plan.creates).toEqual([]);
  });

  it('uploads a local edit as a new revision and a new file into a new folder', () => {
    const local = {
      files: [
        { path: 'README.md', blob: 'readme-2' },
        { path: 'Docs/Guide.pdf', blob: 'guide-1' },
        { path: 'Reference/Specs/Motor.pdf', blob: 'motor' },
      ],
      folders: ['Docs', 'Reference', 'Reference/Specs'],
    };
    const plan = planRootSync(base, local, base);
    expect(plan.replaces).toEqual([{ entryId: A, path: 'README.md', blob: 'readme-2' }]);
    expect(plan.creates).toEqual([{ path: 'Reference/Specs/Motor.pdf', blob: 'motor' }]);
    expect(plan.createFolders).toEqual(['Reference', 'Reference/Specs']);
    expect(plan.downloads).toEqual([]);
  });

  it('downloads a server edit when the local file is unchanged', () => {
    const remote = { ...base, files: [{ entryId: A, path: 'README.md', blob: 'readme-2' }, base.files[1]!] };
    const plan = planRootSync(base, unchangedLocal, remote);
    expect(plan.downloads).toEqual([{ path: 'README.md', blob: 'readme-2' }]);
    expect(plan.replaces).toEqual([]);
  });

  it('keeps both versions when a file changed on both sides', () => {
    const remote = { ...base, files: [{ entryId: A, path: 'README.md', blob: 'theirs' }, base.files[1]!] };
    const local = { ...unchangedLocal, files: [{ path: 'README.md', blob: 'mine' }, unchangedLocal.files[1]!] };
    const plan = planRootSync(base, local, remote);
    expect(plan.conflictCopies).toEqual([{ from: 'README.md', to: 'README (conflict).md' }]);
    expect(plan.creates).toEqual([{ path: 'README (conflict).md', blob: 'mine' }]);
    expect(plan.downloads).toEqual([{ path: 'README.md', blob: 'theirs' }]);
    expect(plan.replaces).toEqual([]);
  });

  it('treats a Finder rename (same bytes under a new name) as a move that keeps the entry', () => {
    const local = { ...unchangedLocal, files: [{ path: 'Docs/Readme.md', blob: 'readme-1' }, unchangedLocal.files[1]!] };
    const plan = planRootSync(base, local, base);
    expect(plan.moves).toEqual([{ entryId: A, from: 'README.md', to: 'Docs/Readme.md' }]);
    expect(plan.creates).toEqual([]);
    expect(plan.deleteFiles).toEqual([]);
  });

  it('follows a rename made on the server', () => {
    const remote = { ...base, files: [{ entryId: A, path: 'Docs/README.md', blob: 'readme-1' }, base.files[1]!] };
    const plan = planRootSync(base, unchangedLocal, remote);
    expect(plan.localMoves).toEqual([{ from: 'README.md', to: 'Docs/README.md' }]);
    expect(plan.moves).toEqual([]);
    expect(plan.downloads).toEqual([]);
  });

  it('deletes on the server what was deleted here, unless the server changed it meanwhile', () => {
    const local = { ...unchangedLocal, files: [unchangedLocal.files[1]!] };
    expect(planRootSync(base, local, base).deleteFiles).toEqual([base.files[0]]);

    const remote = { ...base, files: [{ entryId: A, path: 'README.md', blob: 'readme-2' }, base.files[1]!] };
    const plan = planRootSync(base, local, remote);
    expect(plan.deleteFiles).toEqual([]);
    expect(plan.downloads).toEqual([{ path: 'README.md', blob: 'readme-2' }]);
  });

  it('deletes here what the server deleted, but keeps a local edit as a new file', () => {
    const remote = { ...base, files: [base.files[1]!] };
    expect(planRootSync(base, unchangedLocal, remote).localDeletes).toEqual(['README.md']);

    const edited = { ...unchangedLocal, files: [{ path: 'README.md', blob: 'mine' }, unchangedLocal.files[1]!] };
    const plan = planRootSync(base, edited, remote);
    expect(plan.localDeletes).toEqual([]);
    expect(plan.creates).toEqual([{ path: 'README.md', blob: 'mine' }]);
  });

  it('adopts a file both sides added with the same bytes, and keeps a copy when they differ', () => {
    const remote = { ...base, files: [...base.files, { entryId: id(3), path: 'BOM.csv', blob: 'bom' }] };
    const same = { ...unchangedLocal, files: [...unchangedLocal.files, { path: 'BOM.csv', blob: 'bom' }] };
    expect(isEmptyPlan(planRootSync(base, same, remote))).toBe(true);

    const different = { ...unchangedLocal, files: [...unchangedLocal.files, { path: 'bom.csv', blob: 'mine' }] };
    const plan = planRootSync(base, different, remote);
    expect(plan.conflictCopies).toEqual([{ from: 'bom.csv', to: 'bom (conflict).csv' }]);
    expect(plan.downloads).toEqual([{ path: 'BOM.csv', blob: 'bom' }]);
  });

  it('deletes a folder removed here, unless something new arrived in it on the server', () => {
    const local = { files: [unchangedLocal.files[0]!], folders: [] };
    const plan = planRootSync(base, local, base);
    expect(plan.deleteFiles).toEqual([base.files[1]]);
    expect(plan.deleteFolders).toEqual([{ entryId: DOCS, path: 'Docs' }]);

    const remote = { ...base, files: [...base.files, { entryId: id(4), path: 'Docs/New.pdf', blob: 'new' }] };
    const kept = planRootSync(base, local, remote);
    expect(kept.deleteFolders).toEqual([]);
    expect(kept.localFolders).toEqual(['Docs']);
    expect(kept.downloads).toContainEqual({ path: 'Docs/New.pdf', blob: 'new' });
  });

  it('creates folders the server added and removes ones it deleted', () => {
    const remote = { files: base.files, folders: [...base.folders, { entryId: REF, path: 'Reference' }] };
    expect(planRootSync(base, unchangedLocal, remote).localFolders).toEqual(['Reference']);

    const withEmpty = { ...base, folders: [...base.folders, { entryId: REF, path: 'Reference' }] };
    const plan = planRootSync(withEmpty, { ...unchangedLocal, folders: ['Docs', 'Reference'] }, base);
    expect(plan.removeLocalFolders).toEqual(['Reference']);
  });
});

describe('pendingRootChanges', () => {
  it('lists what a push would send, without the server', () => {
    const local = {
      files: [
        { path: 'Guide.pdf', blob: 'guide-1' },
        { path: 'Notes.txt', blob: 'notes' },
      ],
      folders: ['Docs'],
    };
    expect(pendingRootChanges(base, local)).toEqual({
      added: ['Notes.txt'],
      modified: [],
      moved: [{ from: 'Docs/Guide.pdf', to: 'Guide.pdf' }],
      deleted: ['README.md'],
      addedFolders: [],
      deletedFolders: [],
    });
  });
});

describe('conflictName', () => {
  it('numbers copies until the name is free, ignoring case', () => {
    expect(conflictName('parts/Arm.SLDPRT', new Set())).toBe('parts/Arm (conflict).SLDPRT');
    expect(conflictName('Makefile', new Set(['makefile (conflict)']))).toBe('Makefile (conflict 2)');
  });
});
