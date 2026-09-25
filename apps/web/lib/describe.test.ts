import type { ApprovalRules, PickRow } from '@gigacad/core';
import { describe, expect, it } from 'vitest';
import type { Commit, Member } from './api';
import { blockerText, branchTone, describeEvent, eligibleApprovers, groupTimeline, rowNote } from './describe';
import { draftFromPicks, picksFromDraft, samePicks } from './picks';

const entry = (itemId: string, path: string, blob = 'b') => ({ itemId, path, blob });

const rows: PickRow[] = [
  {
    itemId: 'asm',
    path: 'Robot.SLDASM',
    branchChange: { kind: 'modified', itemId: 'asm', before: entry('asm', 'Robot.SLDASM'), after: entry('asm', 'Robot.SLDASM', 'c'), contentChanged: true, moved: false },
    mainChange: { kind: 'modified', itemId: 'asm', before: entry('asm', 'Robot.SLDASM'), after: entry('asm', 'Robot.SLDASM', 'd'), contentChanged: true, moved: false },
    conflict: true,
    defaultAction: 'take_branch',
  },
  {
    itemId: 'p3',
    path: 'parts/P3.SLDPRT',
    branchChange: { kind: 'added', itemId: 'p3', after: entry('p3', 'parts/P3.SLDPRT') },
    mainChange: undefined,
    conflict: false,
    defaultAction: 'take_branch',
  },
  {
    itemId: 'plate',
    path: 'plate.SLDPRT',
    branchChange: undefined,
    mainChange: { kind: 'modified', itemId: 'plate', before: entry('plate', 'plate.SLDPRT'), after: entry('plate', 'plate.SLDPRT', 'e'), contentChanged: true, moved: false },
    conflict: false,
    defaultAction: 'keep_main',
  },
];

describe('pick table', () => {
  it('describes each row the way the demo does', () => {
    expect(rowNote(rows[0]!, 7)).toEqual({ text: 'Changed on both sides', caution: true });
    expect(rowNote(rows[1]!, 7)).toEqual({ text: 'New on branch', caution: false });
    expect(rowNote(rows[2]!, 7)).toEqual({ text: 'Changed on main in v7', caution: false });
  });

  it('round-trips picks and sends only overrides', () => {
    const saved = { actions: { asm: 'keep_main' as const }, replacements: [{ branchItemId: 'p3', mainItemId: 'p4' }] };
    const draft = draftFromPicks(rows, saved);
    expect(draft).toEqual({
      asm: { kind: 'action', action: 'keep_main' },
      p3: { kind: 'replace', mainItemId: 'p4' },
      plate: { kind: 'action', action: 'keep_main' },
    });
    expect(picksFromDraft(rows, draft)).toEqual(saved);
    expect(samePicks(rows, draft, draftFromPicks(rows, {}))).toBe(false);
    expect(picksFromDraft(rows, draftFromPicks(rows, {}))).toEqual({ actions: {}, replacements: [] });
  });
});

describe('approvals', () => {
  const members: Member[] = [
    { userId: 'alex', handle: 'alex', displayName: null, role: 'owner' },
    { userId: 'sam', handle: 'sam', displayName: null, role: 'maintainer' },
    { userId: 'kim', handle: 'kim', displayName: null, role: 'contributor' },
  ];
  const rules: ApprovalRules = { requiredCount: 1, approverUserIds: ['kim'], approverRoles: ['owner', 'maintainer'], allowSelfApproval: false, requireCleanRebuild: false };

  it('lists members the rules allow, minus the requester unless self-approval is on', () => {
    expect(eligibleApprovers(members, rules, 'alex').map((m) => m.handle)).toEqual(['sam', 'kim']);
    expect(eligibleApprovers(members, { ...rules, allowSelfApproval: true }, 'alex').map((m) => m.handle)).toEqual(['alex', 'sam', 'kim']);
  });

  it('explains blockers in plain words', () => {
    expect(blockerText({ kind: 'needs_approvals', have: 0, need: 2 })).toBe('Needs 2 more approvals');
    expect(blockerText({ kind: 'rebuild_missing' })).toContain('SolidWorks add-in');
  });
});

describe('history', () => {
  const commit = (id: string, kind: Commit['kind']): Commit => ({
    id,
    kind,
    branchId: 'b',
    parentId: null,
    manifestId: 'm',
    message: '',
    versionLabel: null,
    authorId: null,
    authorHandle: null,
    createdAt: '2026-09-24T00:00:00Z',
  });

  it('folds consecutive autosaves into one group', () => {
    const timeline = groupTimeline([commit('a3', 'autosave'), commit('a2', 'autosave'), commit('v2', 'version'), commit('v1', 'version')]);
    expect(timeline.map((entry) => (entry.kind === 'autosaves' ? `autosaves:${entry.commits.length}` : entry.commit.id))).toEqual([
      'autosaves:2',
      'v2',
      'v1',
    ]);
  });

  it('writes events as sentences and skips noise', () => {
    const names = { handle: (id: string | null) => `@${id}`, branch: () => 'dev' };
    const base = { id: '1', actorId: 'alex', subjectId: 'b', createdAt: '' };
    expect(describeEvent({ ...base, kind: 'release_created', payload: { number: 3 } }, names)).toBe('@alex released v3');
    expect(describeEvent({ ...base, kind: 'branch_checked_out', payload: {} }, names)).toBe('@alex checked out dev');
    expect(describeEvent({ ...base, kind: 'commit_created', payload: { kind: 'autosave' } }, names)).toBeUndefined();
  });

  it('gives each branch state one tone', () => {
    expect(['open', 'frozen', 'released', 'archived'].map((status) => branchTone(status as never))).toEqual(['open', 'caution', 'signal', 'quiet']);
  });
});
