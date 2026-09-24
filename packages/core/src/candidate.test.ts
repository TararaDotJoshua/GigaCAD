import { describe, expect, it } from 'vitest';
import { buildCandidate, buildPickRows } from './candidate.js';
import type { ManifestEntry } from './manifest.js';

const entry = (itemId: string, path: string, blob: string): ManifestEntry => ({ itemId, path, blob });

const base = [
  entry('asm', 'Robot.SLDASM', 'asm-v1'),
  entry('p1', 'parts/Arm.SLDPRT', 'p1-v1'),
  entry('p2', 'parts/Base.SLDPRT', 'p2-v1'),
];

describe('buildPickRows', () => {
  it('lists items changed on either side, defaulting to the side that changed', () => {
    const latestMain = [base[0]!, entry('p1', 'parts/Arm.SLDPRT', 'p1-main'), base[2]!];
    const branchHead = [base[0]!, base[1]!, entry('p2', 'parts/Base.SLDPRT', 'p2-branch')];

    const rows = buildPickRows({ base, branchHead, latestMain });

    expect(rows.map((row) => [row.itemId, row.defaultAction, row.conflict])).toEqual([
      ['p1', 'keep_main', false],
      ['p2', 'take_branch', false],
    ]);
  });

  it('does not flag identical changes on both sides as a conflict', () => {
    const same = [base[0]!, entry('p1', 'parts/Arm.SLDPRT', 'p1-same'), base[2]!];
    const [row] = buildPickRows({ base, branchHead: same, latestMain: same });
    expect(row?.conflict).toBe(false);
  });
});

describe('buildCandidate', () => {
  it('applies branch changes on top of newer main releases', () => {
    const latestMain = [base[0]!, entry('p1', 'parts/Arm.SLDPRT', 'p1-main'), base[2]!];
    const branchHead = [base[0]!, base[1]!, entry('p2', 'parts/Base.SLDPRT', 'p2-branch')];

    const candidate = buildCandidate({ base, branchHead, latestMain });

    expect(candidate.ok).toBe(true);
    expect(candidate.warnings).toEqual([]);
    expect(candidate.manifest).toEqual([
      entry('p1', 'parts/Arm.SLDPRT', 'p1-main'),
      entry('p2', 'parts/Base.SLDPRT', 'p2-branch'),
      base[0]!,
    ]);
  });

  it('lets the branch overwrite a newer main change and warns about it', () => {
    const latestMain = [base[0]!, entry('p1', 'parts/Arm.SLDPRT', 'p1-main'), base[2]!];
    const branchHead = [base[0]!, entry('p1', 'parts/Arm.SLDPRT', 'p1-branch'), base[2]!];

    const candidate = buildCandidate({ base, branchHead, latestMain });

    expect(candidate.rows[0]?.conflict).toBe(true);
    expect(candidate.manifest).toContainEqual(entry('p1', 'parts/Arm.SLDPRT', 'p1-branch'));
    expect(candidate.warnings).toEqual([{ kind: 'overwrites_main_change', itemId: 'p1', path: 'parts/Arm.SLDPRT' }]);
  });

  it('keeps main when picked and warns that branch work is discarded', () => {
    const latestMain = [base[0]!, entry('p1', 'parts/Arm.SLDPRT', 'p1-main'), base[2]!];
    const branchHead = [base[0]!, entry('p1', 'parts/Arm.SLDPRT', 'p1-branch'), base[2]!];

    const candidate = buildCandidate({ base, branchHead, latestMain, picks: { actions: { p1: 'keep_main' } } });

    expect(candidate.manifest).toContainEqual(entry('p1', 'parts/Arm.SLDPRT', 'p1-main'));
    expect(candidate.warnings).toEqual([{ kind: 'discards_branch_change', itemId: 'p1', path: 'parts/Arm.SLDPRT' }]);
  });

  it('removes branch deletions by default and keeps them when picked', () => {
    const branchHead = [base[0]!, base[1]!];

    expect(buildCandidate({ base, branchHead, latestMain: base }).manifest.map((e) => e.itemId)).toEqual(['p1', 'asm']);
    const kept = buildCandidate({ base, branchHead, latestMain: base, picks: { actions: { p2: 'keep_main' } } });
    expect(kept.manifest.map((e) => e.itemId)).toEqual(['p1', 'p2', 'asm']);
  });

  it('adds new branch files unless kept out', () => {
    const branchHead = [...base, entry('p3', 'parts/Gripper.SLDPRT', 'p3-v1')];

    expect(buildCandidate({ base, branchHead, latestMain: base }).manifest).toContainEqual(branchHead[3]);
    const without = buildCandidate({ base, branchHead, latestMain: base, picks: { actions: { p3: 'keep_main' } } });
    expect(without.manifest).not.toContainEqual(branchHead[3]);
  });

  it('handles the full diff-pick scenario with a replaced part inheriting its item id', () => {
    // v1: an assembly with four parts. Branch A edited P1 and was released as v2.
    const v1 = [
      entry('asm', 'Robot.SLDASM', 'asm-v1'),
      entry('p1', 'parts/P1.SLDPRT', 'p1-v1'),
      entry('p2', 'parts/P2.SLDPRT', 'p2-v1'),
      entry('p4', 'parts/P4.SLDPRT', 'p4-v1'),
    ];
    const v2 = [v1[0]!, entry('p1', 'parts/P1.SLDPRT', 'p1-A'), v1[2]!, v1[3]!];
    // Branch B (from v1) edited P1 and P2, and made P3 to replace P4.
    const branchB = [
      entry('asm', 'Robot.SLDASM', 'asm-B'),
      entry('p1', 'parts/P1.SLDPRT', 'p1-B'),
      entry('p2', 'parts/P2.SLDPRT', 'p2-B'),
      entry('p3', 'parts/P3.SLDPRT', 'p3-B'),
    ];
    const references = new Map([
      ['asm-v1', ['parts/P1.SLDPRT', 'parts/P2.SLDPRT', 'parts/P4.SLDPRT']],
      ['asm-B', ['parts/P1.SLDPRT', 'parts/P2.SLDPRT', 'parts/P3.SLDPRT']],
    ]);

    const candidate = buildCandidate({
      base: v1,
      branchHead: branchB,
      latestMain: v2,
      picks: { actions: { asm: 'keep_main', p1: 'keep_main' }, replacements: [{ branchItemId: 'p3', mainItemId: 'p4' }] },
      references,
    });

    expect(candidate.ok).toBe(true);
    expect(candidate.manifest).toEqual([
      entry('p1', 'parts/P1.SLDPRT', 'p1-A'),
      entry('p2', 'parts/P2.SLDPRT', 'p2-B'),
      entry('p4', 'parts/P3.SLDPRT', 'p3-B'),
      entry('asm', 'Robot.SLDASM', 'asm-v1'),
    ]);
    expect(candidate.replacements).toEqual([
      { mainItemId: 'p4', branchItemId: 'p3', fromPath: 'parts/P4.SLDPRT', toPath: 'parts/P3.SLDPRT' },
    ]);
    expect(candidate.warnings).toContainEqual({
      kind: 'needs_repoint',
      itemId: 'asm',
      path: 'Robot.SLDASM',
      fromPath: 'parts/P4.SLDPRT',
      toPath: 'parts/P3.SLDPRT',
    });
  });

  it('asks for a repoint even when the replacement lands on the same path', () => {
    const main = [entry('asm', 'A.SLDASM', 'asm'), entry('old', 'Part.SLDPRT', 'old')];
    const branchHead = [entry('asm', 'A.SLDASM', 'asm'), entry('new', 'part.sldprt', 'new')];

    const candidate = buildCandidate({
      base: main,
      branchHead,
      latestMain: main,
      picks: { replacements: [{ branchItemId: 'new', mainItemId: 'old' }] },
      references: new Map([['asm', ['Part.SLDPRT']]]),
    });

    expect(candidate.ok).toBe(true);
    expect(candidate.manifest).toContainEqual(entry('old', 'part.sldprt', 'new'));
    expect(candidate.warnings.map((w) => w.kind)).toEqual(['needs_repoint']);
  });

  it('rejects invalid replacements', () => {
    const branchHead = [...base, entry('p3', 'parts/New.SLDPRT', 'p3')];
    const candidate = buildCandidate({
      base,
      branchHead,
      latestMain: base,
      picks: {
        actions: { p2: 'keep_main' },
        replacements: [
          { branchItemId: 'p3', mainItemId: 'missing' },
          { branchItemId: 'p2', mainItemId: 'p1' },
          { branchItemId: 'p3', mainItemId: 'p2' },
          { branchItemId: 'p3', mainItemId: 'p1' },
          { branchItemId: 'p3', mainItemId: 'asm' },
        ],
      },
    });

    expect(candidate.ok).toBe(false);
    expect(candidate.errors.map((e) => (e.kind === 'invalid_replacement' ? e.reason : e.kind))).toEqual([
      'unknown_item',
      'the main item is not in the latest release',
      'only files that are new on the branch can replace a main item',
      'an item in a replacement cannot also have a pick action',
      'the branch item is already used in another replacement',
    ]);
    expect(candidate.manifest).toContainEqual(entry('p1', 'parts/New.SLDPRT', 'p3'));
  });

  it('reports picks for items that did not change', () => {
    const candidate = buildCandidate({ base, branchHead: base, latestMain: base, picks: { actions: { p1: 'take_branch' } } });
    expect(candidate.errors).toEqual([{ kind: 'unknown_item', itemId: 'p1' }]);
  });

  it('reports files that would collide on a case-insensitive file system', () => {
    const latestMain = [...base, entry('m', 'parts/Bracket.SLDPRT', 'm')];
    const branchHead = [...base, entry('b', 'parts/bracket.sldprt', 'b')];

    const candidate = buildCandidate({ base, branchHead, latestMain });

    expect(candidate.errors).toEqual([{ kind: 'path_collision', path: 'parts/Bracket.SLDPRT', itemIds: ['m', 'b'] }]);
  });

  it('warns about missing references and mixed branch/main sources', () => {
    const branchHead = [
      entry('asm', 'Robot.SLDASM', 'asm-branch'),
      entry('p1', 'parts/Arm.SLDPRT', 'p1-branch'),
    ];
    const candidate = buildCandidate({
      base,
      branchHead,
      latestMain: base,
      picks: { actions: { p1: 'keep_main', p2: 'keep_main' } },
      references: new Map([['asm-branch', ['parts\\Arm.SLDPRT', 'parts/Missing.SLDPRT']]]),
    });

    expect(candidate.warnings).toEqual([
      { kind: 'discards_branch_change', itemId: 'p1', path: 'parts/Arm.SLDPRT' },
      { kind: 'discards_branch_change', itemId: 'p2', path: 'parts/Base.SLDPRT' },
      {
        kind: 'mixed_sources',
        itemId: 'asm',
        path: 'Robot.SLDASM',
        referencedItemId: 'p1',
        referencedPath: 'parts/Arm.SLDPRT',
      },
      { kind: 'missing_reference', itemId: 'asm', path: 'Robot.SLDASM', referencedPath: 'parts/Missing.SLDPRT' },
    ]);
  });
});
