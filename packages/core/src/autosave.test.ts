import { describe, expect, it } from 'vitest';
import { planAutosavePrune, type BranchCommit } from './autosave.js';

// v1 <- a1 <- a2 <- v2 <- a3
const history: BranchCommit[] = [
  { id: 'v1', parentId: null, kind: 'version' },
  { id: 'a1', parentId: 'v1', kind: 'autosave' },
  { id: 'a2', parentId: 'a1', kind: 'autosave' },
  { id: 'v2', parentId: 'a2', kind: 'version' },
  { id: 'a3', parentId: 'v2', kind: 'autosave' },
];

describe('planAutosavePrune', () => {
  it('removes the autosaves before a newly committed version', () => {
    const upToV2 = history.slice(0, 4);

    expect(planAutosavePrune(upToV2, 'v2', 'version')).toEqual({
      deleteIds: ['a1', 'a2'],
      reparent: [{ commitId: 'v2', newParentId: 'v1' }],
      newHeadId: 'v2',
    });
  });

  it('keeps autosaves made after the newest version', () => {
    expect(planAutosavePrune(history, 'a3', 'version')).toEqual({
      deleteIds: ['a1', 'a2'],
      reparent: [{ commitId: 'v2', newParentId: 'v1' }],
      newHeadId: 'a3',
    });
  });

  it('removes every autosave when the branch is released', () => {
    expect(planAutosavePrune(history, 'a3', 'release')).toEqual({
      deleteIds: ['a1', 'a2', 'a3'],
      reparent: [{ commitId: 'v2', newParentId: 'v1' }],
      newHeadId: 'v2',
    });
  });

  it('relinks a version whose whole ancestry was autosaves', () => {
    const commits: BranchCommit[] = [
      { id: 'a1', parentId: null, kind: 'autosave' },
      { id: 'v1', parentId: 'a1', kind: 'version' },
    ];

    expect(planAutosavePrune(commits, 'v1', 'version')).toEqual({
      deleteIds: ['a1'],
      reparent: [{ commitId: 'v1', newParentId: null }],
      newHeadId: 'v1',
    });
  });

  it('refuses broken histories', () => {
    expect(() => planAutosavePrune(history.slice(1), 'a3', 'release')).toThrow(/missing/);
    const loop: BranchCommit[] = [
      { id: 'x', parentId: 'y', kind: 'autosave' },
      { id: 'y', parentId: 'x', kind: 'autosave' },
    ];
    expect(() => planAutosavePrune(loop, 'x', 'release')).toThrow(/loops/);
  });
});
