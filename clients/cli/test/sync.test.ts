import type { ManifestEntry } from '@gigacad/core';
import { describe, expect, it } from 'vitest';
import { commitFiles, localChanges, planPull } from '../src/sync.js';
import { trackedFrom } from '../src/workspace.js';

const base: ManifestEntry[] = [
  { itemId: 'item-asm', path: 'Robot.SLDASM', blob: 'asm1' },
  { itemId: 'item-p1', path: 'parts/P1.SLDPRT', blob: 'p1v1' },
  { itemId: 'item-p2', path: 'parts/P2.SLDPRT', blob: 'p2v1' },
];
const synced = { base, tracked: trackedFrom(base) };
const files = (entries: ManifestEntry[]) => entries.map(({ path, blob }) => ({ path, blob }));

describe('local changes', () => {
  it('reports nothing for an untouched workspace', () => {
    expect(localChanges(synced, files(base))).toEqual([]);
  });

  it('describes adds, edits, and deletes', () => {
    const working = [
      { path: 'Robot.SLDASM', blob: 'asm2' },
      { path: 'parts/P1.SLDPRT', blob: 'p1v1' },
      { path: 'parts/P3.SLDPRT', blob: 'p3' },
    ];
    expect(localChanges(synced, working)).toEqual([
      { kind: 'deleted', path: 'parts/P2.SLDPRT', itemId: 'item-p2' },
      { kind: 'added', path: 'parts/P3.SLDPRT' },
      { kind: 'modified', path: 'Robot.SLDASM', itemId: 'item-asm' },
    ]);
  });

  it('keeps item identity across a giga mv, and sends it with the commit', () => {
    const moved = { base, tracked: { ...trackedFrom(base.filter((f) => f.itemId !== 'item-p2')), 'parts/Bracket.SLDPRT': 'item-p2' } };
    const working = [
      { path: 'Robot.SLDASM', blob: 'asm1' },
      { path: 'parts/P1.SLDPRT', blob: 'p1v1' },
      { path: 'parts/Bracket.SLDPRT', blob: 'p2v2' },
      { path: 'parts/P2.SLDPRT', blob: 'brand new' },
    ];
    expect(localChanges(moved, working)).toEqual([
      { kind: 'moved', path: 'parts/Bracket.SLDPRT', from: 'parts/P2.SLDPRT', itemId: 'item-p2', modified: true },
      { kind: 'added', path: 'parts/P2.SLDPRT' },
    ]);
    expect(commitFiles(moved, working)).toEqual([
      { path: 'Robot.SLDASM', blob: 'asm1', itemId: 'item-asm' },
      { path: 'parts/P1.SLDPRT', blob: 'p1v1', itemId: 'item-p1' },
      { path: 'parts/Bracket.SLDPRT', blob: 'p2v2', itemId: 'item-p2' },
      // New file at the old path: no item id, so the server creates one.
      { path: 'parts/P2.SLDPRT', blob: 'brand new' },
    ]);
  });

  it('treats a plain rename outside giga as a delete plus an add', () => {
    const working = [
      { path: 'Robot.SLDASM', blob: 'asm1' },
      { path: 'parts/P1.SLDPRT', blob: 'p1v1' },
      { path: 'parts/Renamed.SLDPRT', blob: 'p2v1' },
    ];
    expect(localChanges(synced, working).map((change) => change.kind)).toEqual(['deleted', 'added']);
  });
});

describe('pull planning', () => {
  const remoteEdit: ManifestEntry[] = [
    { itemId: 'item-asm', path: 'Robot.SLDASM', blob: 'asm1' },
    { itemId: 'item-p1', path: 'parts/P1.SLDPRT', blob: 'p1v2' },
    { itemId: 'item-p2', path: 'parts/P2-renamed.SLDPRT', blob: 'p2v1' },
    { itemId: 'item-p9', path: 'parts/P9.SLDPRT', blob: 'p9' },
  ];

  it('applies remote edits, moves, and adds to a clean workspace', () => {
    const plan = planPull(synced, files(base), remoteEdit);
    expect(plan.conflicts).toEqual([]);
    expect(plan.deletes).toEqual(['parts/P2.SLDPRT']);
    expect(plan.writes.map((entry) => entry.path).sort()).toEqual(['parts/P1.SLDPRT', 'parts/P2-renamed.SLDPRT', 'parts/P9.SLDPRT']);
    expect(plan.tracked).toEqual(trackedFrom(remoteEdit));
  });

  it('keeps local edits to files the branch did not change', () => {
    const working = files(base).map((file) => (file.path === 'Robot.SLDASM' ? { ...file, blob: 'asm local' } : file));
    const plan = planPull(synced, working, remoteEdit);
    expect(plan.conflicts).toEqual([]);
    expect(plan.writes.map((entry) => entry.path)).not.toContain('Robot.SLDASM');
  });

  it('refuses to overwrite a file changed both locally and on the branch', () => {
    const working = files(base).map((file) => (file.path === 'parts/P1.SLDPRT' ? { ...file, blob: 'p1 local' } : file));
    const plan = planPull(synced, working, remoteEdit);
    expect(plan.conflicts).toEqual([{ path: 'parts/P1.SLDPRT', reason: 'changed locally and on the branch' }]);
  });

  it('refuses to replace an untracked local file that is in the way', () => {
    const working = [...files(base), { path: 'parts/P9.SLDPRT', blob: 'my own P9' }];
    expect(planPull(synced, working, remoteEdit).conflicts.map((conflict) => conflict.path)).toEqual(['parts/P9.SLDPRT']);
    // The same bytes are not a conflict.
    expect(planPull(synced, [...files(base), { path: 'parts/P9.SLDPRT', blob: 'p9' }], remoteEdit).conflicts).toEqual([]);
  });

  it('restores a locally deleted file the branch changed, since nothing is lost', () => {
    const working = files(base).filter((file) => file.path !== 'parts/P1.SLDPRT');
    const plan = planPull(synced, working, remoteEdit);
    expect(plan.conflicts).toEqual([]);
    expect(plan.writes.map((entry) => entry.path)).toContain('parts/P1.SLDPRT');
  });

  it('blocks while local moves are uncommitted', () => {
    const moved = { base, tracked: { ...trackedFrom(base.filter((f) => f.itemId !== 'item-asm')), 'Robot2.SLDASM': 'item-asm' } };
    const working = files(base).map((file) => (file.path === 'Robot.SLDASM' ? { ...file, path: 'Robot2.SLDASM' } : file));
    expect(planPull(moved, working, remoteEdit).conflicts[0]).toMatchObject({ path: 'Robot2.SLDASM' });
  });

  it('does nothing when the branch has no file changes', () => {
    const plan = planPull(synced, files(base), base);
    expect(plan).toMatchObject({ conflicts: [], writes: [], deletes: [], remoteChanges: 0 });
  });
});
