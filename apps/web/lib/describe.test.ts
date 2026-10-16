import type { ApprovalRules, PickRow } from '@gigacad/core';
import { describe, expect, it } from 'vitest';
import type { Commit, Member } from './api';
import { blockerText, branchTone, collapseActivity, describeEvent, eligibleApprovers, errorText, groupTimeline, requestBadge, rowNote, ruleSummary, warningText } from './describe';
import { draftFromPicks, hasStrayPicks, outcomeText, pickChoices, pickLabel, pickOutcome, picksFromDraft, replaceableFiles, samePicks } from './picks';

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
    { userId: 'alex', handle: 'alex', displayName: null, avatarUrl: null, role: 'owner' },
    { userId: 'sam', handle: 'sam', displayName: null, avatarUrl: null, role: 'maintainer' },
    { userId: 'kim', handle: 'kim', displayName: null, avatarUrl: null, role: 'contributor' },
  ];
  const rules: ApprovalRules = { requiredCount: 1, approverUserIds: ['kim'], approverRoles: ['owner', 'maintainer'], allowSelfApproval: false, requireCleanRebuild: false };

  it('lists members the rules allow, minus the requester unless self-approval is on', () => {
    expect(eligibleApprovers(members, rules, 'alex').map((m) => m.handle)).toEqual(['sam', 'kim']);
    expect(eligibleApprovers(members, { ...rules, allowSelfApproval: true }, 'alex').map((m) => m.handle)).toEqual(['alex', 'sam', 'kim']);
  });

  it('explains blockers in plain sentences', () => {
    expect(blockerText({ kind: 'needs_approvals', have: 0, need: 2 })).toBe('Needs 2 more approvals.');
    expect(blockerText({ kind: 'rebuild_missing' })).toBe('Needs a clean SolidWorks rebuild of this candidate.');
  });

  it('sums up the rule, naming listed people', () => {
    expect(ruleSummary(rules, new Map([['kim', 'kim']]))).toBe('Needs 1 approval from an owner, a maintainer or @kim. The requester can’t approve their own request.');
    expect(ruleSummary({ ...rules, requiredCount: 0 })).toBe('No approval is needed to release.');
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

  it('names releases and says what reset a request’s approvals', () => {
    const base = { id: '1', actorId: 'alex', subjectId: 'r', createdAt: '2026-09-24T00:00:00Z' };
    const names = { handle: () => '@alex', branch: () => undefined };
    expect(describeEvent({ ...base, kind: 'release_created', payload: { number: 3, title: 'Lighter arm' } }, names)).toBe('@alex released v3: Lighter arm');
    expect(describeEvent({ ...base, kind: 'release_request_picks_changed', payload: { number: 2 } }, names)).toBe('@alex changed the picks on release request #2, which resets its approvals');
    expect(describeEvent({ ...base, kind: 'release_request_candidate_updated', payload: { number: 2, changedFiles: 1 } }, names)).toBe(
      '@alex saved a rebuilt file into the candidate on release request #2, which resets its approvals',
    );
    expect(describeEvent({ ...base, kind: 'export_replaced', payload: { format: 'step', path: 'parts/Wheel.SLDPRT' } }, names)).toBe('@alex replaced the STEP export of parts/Wheel.SLDPRT');
    expect(describeEvent({ ...base, kind: 'directory_entry_moved', payload: { from: 'cuts/a.dxf', to: 'cuts/b.dxf' } }, names)).toBe('@alex renamed cuts/a.dxf to cuts/b.dxf');
    expect(describeEvent({ ...base, kind: 'directory_entry_moved', payload: { from: 'cuts/a.dxf', to: 'a.dxf' } }, names)).toBe('@alex moved cuts/a.dxf to a.dxf');
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

describe('activity feed', () => {
  const names = { handle: (id: string | null) => `@${id}`, branch: (id: string | null) => (id === 'b1' ? 'longer-arms' : undefined) };
  const at = (kind: string, actorId: string, subjectId: string | null, payload: Record<string, unknown> | null = null) => ({
    event: { id: `${kind}-${Math.random()}`, kind, actorId, subjectId, payload, createdAt: '2026-09-30T00:00:00Z' },
    text: kind,
  });

  it('folds one person’s run of branch work into a line, and keeps everything else', () => {
    const feed = collapseActivity(
      [
        at('release_request_opened', 'alex', 'rr', { number: 2 }),
        at('branch_checked_in', 'alex', 'b1'),
        at('commit_created', 'alex', 'b1', { kind: 'version' }),
        at('commit_created', 'alex', 'b1', { kind: 'version' }),
        at('branch_checked_out', 'alex', 'b1'),
        at('branch_checked_in', 'sam', 'b1'),
        at('branch_checked_out', 'sam', 'b1'),
        at('project_created', 'alex', null),
      ],
      names,
    );
    expect(feed.map((entry) => entry.text)).toEqual(['release_request_opened', '@alex committed 2 versions on longer-arms', '@sam worked on longer-arms', 'project_created']);
  });
});

describe('pick outcome', () => {
  const entry = (path: string) => ({ itemId: path, path, blob: path });
  const rows = [
    { itemId: 'a', path: 'A.SLDPRT', branchChange: { kind: 'modified', itemId: 'a', before: entry('A'), after: entry('A2'), contentChanged: true, moved: false }, mainChange: undefined, conflict: false, defaultAction: 'take_branch' },
    { itemId: 'b', path: 'B.SLDPRT', branchChange: { kind: 'added', itemId: 'b', after: entry('B') }, mainChange: undefined, conflict: false, defaultAction: 'take_branch' },
    { itemId: 'c', path: 'C.SLDPRT', branchChange: { kind: 'deleted', itemId: 'c', before: entry('C') }, mainChange: undefined, conflict: false, defaultAction: 'take_branch' },
  ] as unknown as PickRow[];

  it('counts what the release will change, and says when it changes nothing', () => {
    const draft = draftFromPicks(rows, {});
    expect(outcomeText(pickOutcome(rows, draft))).toBe('3 files: 1 edited, 1 added, 1 removed');
    const kept = { ...draft, a: { kind: 'action' as const, action: 'keep_main' as const }, b: { kind: 'replace' as const, mainItemId: 'x' } };
    expect(outcomeText(pickOutcome(rows, kept))).toBe('2 files: 1 removed, 1 replacing a main file');
    expect(outcomeText(pickOutcome(rows, Object.fromEntries(rows.map((row) => [row.itemId, { kind: 'action' as const, action: 'keep_main' as const }]))))).toBe('no files: main stays as it is');
  });
});

describe('pick choices', () => {
  const change = (kind: 'added' | 'deleted' | 'modified', path: string) =>
    kind === 'added' ? { kind, itemId: path, after: entry(path, path) } : kind === 'deleted' ? { kind, itemId: path, before: entry(path, path) } : { kind, itemId: path, before: entry(path, path), after: entry(path, path, 'n'), contentChanged: true, moved: false };
  const row = (itemId: string, branch?: 'added' | 'deleted' | 'modified', main?: 'added' | 'deleted' | 'modified'): PickRow =>
    ({ itemId, path: itemId, branchChange: branch && change(branch, itemId), mainChange: main && change(main, itemId), conflict: Boolean(branch && main), defaultAction: branch ? 'take_branch' : 'keep_main' }) as PickRow;
  const numbers = { base: 1, latest: 3 };

  it('names choices for files only main changed by what they do', () => {
    expect(pickChoices(row('new-on-main', undefined, 'added'), numbers)).toEqual({ take: 'Remove', keep: 'Keep v3' });
    expect(pickChoices(row('gone-on-main', undefined, 'deleted'), numbers)).toEqual({ take: 'Restore from v1', keep: 'Keep removed' });
    expect(pickChoices(row('edited-on-main', undefined, 'modified'), numbers)).toEqual({ take: 'Revert to v1', keep: 'Keep v3' });
    expect(pickChoices(row('added', 'added'), numbers)).toEqual({ take: 'Add as new', keep: 'Keep main' });
    expect(pickLabel(row('added', 'added'), { kind: 'action', action: 'take_branch' }, numbers, () => undefined)).toBe('Add as new');
  });

  it('counts undoing main’s changes as removals, restores, and reverts, not edits', () => {
    const rows = [row('new-on-main', undefined, 'added'), row('gone-on-main', undefined, 'deleted'), row('edited-on-main', undefined, 'modified')];
    const taken = Object.fromEntries(rows.map((r) => [r.itemId, { kind: 'action' as const, action: 'take_branch' as const }]));
    expect(outcomeText(pickOutcome(rows, taken))).toBe('3 files: 1 removed, 1 reverted, 1 restored');
  });

  it('counts a replaced file once, sends no action for it, and never offers a file the branch edited', () => {
    const rows = [row('p3', 'added'), row('p4', 'deleted'), row('p1', 'modified')];
    const draft = { ...draftFromPicks(rows, {}), p3: { kind: 'replace' as const, mainItemId: 'p4' }, p4: { kind: 'action' as const, action: 'keep_main' as const } };
    expect(outcomeText(pickOutcome(rows, draft))).toBe('2 files: 1 edited, 1 replacing a main file');
    expect(picksFromDraft(rows, draft)).toEqual({ actions: {}, replacements: [{ branchItemId: 'p3', mainItemId: 'p4' }] });
    expect(replaceableFiles([entry('p1', 'p1'), entry('p4', 'p4')], rows).map((file) => file.itemId)).toEqual(['p4']);
  });

  it('treats saved picks the table can’t show as something to save away', () => {
    const rows = [row('p1', 'modified')];
    expect(hasStrayPicks(rows, { actions: { p1: 'keep_main' } })).toBe(false);
    expect(hasStrayPicks(rows, { actions: { ghost: 'keep_main' } })).toBe(true);
  });
});

describe('pick problems', () => {
  it('say which files they are about', () => {
    expect(warningText({ kind: 'discards_branch_change', itemId: 'w', path: 'parts/Wheel.SLDPRT' })).toBe('parts/Wheel.SLDPRT keeps main’s version, so the branch’s change to it is left out.');
    expect(warningText({ kind: 'needs_repoint', itemId: 'a', path: 'Rover.SLDASM', fromPath: 'parts/P4.SLDPRT', toPath: 'parts/P3.SLDPRT' })).toBe(
      'Rover.SLDASM references parts/P4.SLDPRT, which parts/P3.SLDPRT replaces. The SolidWorks rebuild must repoint it.',
    );
    const pathOf = (id: string) => ({ p3: 'parts/P3.SLDPRT', p4: 'parts/P4.SLDPRT' })[id];
    expect(errorText({ kind: 'invalid_replacement', branchItemId: 'p3', mainItemId: 'p4', reason: 'the main item is already being replaced' }, pathOf)).toBe(
      'parts/P3.SLDPRT can’t replace parts/P4.SLDPRT: the main item is already being replaced.',
    );
    expect(errorText({ kind: 'unknown_item', itemId: '0123456789abcdef' }, pathOf)).toContain('item 01234567');
  });
});

describe('request badge', () => {
  it('is only "Candidate ready" when the candidate is current and its rebuild didn’t fail', () => {
    const candidate = { status: 'candidate' as const, upToDate: true, rebuildStatus: null };
    expect(requestBadge(candidate, false)).toEqual({ label: 'Candidate ready', tone: 'open' });
    expect(requestBadge({ ...candidate, upToDate: false }, false)).toEqual({ label: 'Needs regenerating', tone: 'caution' });
    expect(requestBadge({ ...candidate, rebuildStatus: 'failed' }, false)).toEqual({ label: 'Rebuild failed', tone: 'danger' });
    expect(requestBadge(candidate, true)).toEqual({ label: 'Waiting for rebuild', tone: 'open' });
    expect(requestBadge({ ...candidate, status: 'released' }, true)).toEqual({ label: 'Released', tone: 'signal' });
  });
});
