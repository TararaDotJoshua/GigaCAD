import { describe, expect, it } from 'vitest';
import { exportsMoved, reconcile, reviewChanged, settleOwnChange, type Review, type Shown } from './request-review';

const shown = (candidateId: string | null, exportsChangedAt: string | null = null): Shown => ({ candidateId, exportsChangedAt });
const reviewing = (seen: Shown): Review => ({ reviewed: seen, own: null });

describe('what is under review', () => {
  it('moves to the candidate the viewer’s own action built', () => {
    const running: Review = { reviewed: shown('a'), own: 'running' };
    // The candidate is cleared and rebuilt while the action runs; nothing is flagged meanwhile.
    expect(reviewChanged(running, shown(null))).toBe(false);
    const done = { ...running, own: settleOwnChange({ message: 'Built the candidate.', candidateManifestId: 'b' }) };
    expect(reconcile(done, shown('b', '2026-10-17T10:00:00.000Z'))).toEqual(reviewing(shown('b', '2026-10-17T10:00:00.000Z')));
  });

  it('doesn’t adopt someone else’s candidate after the viewer’s own action failed', () => {
    const failed: Review = { reviewed: shown('a'), own: settleOwnChange({ error: 'That didn’t go through.' }) };
    const later = reconcile(failed, shown('foreign'));
    expect(later.reviewed.candidateId).toBe('a');
    expect(reviewChanged(later, shown('foreign'))).toBe(true);
  });

  it('doesn’t adopt a different candidate than the one the viewer’s action built', () => {
    const done: Review = { reviewed: shown('a'), own: settleOwnChange({ candidateManifestId: 'mine' }) };
    expect(reconcile(done, shown('foreign'))).toEqual(done);
    expect(reviewChanged(reconcile(done, shown('foreign')), shown('foreign'))).toBe(true);
  });

  it('accepts a save that left no candidate', () => {
    const done: Review = { reviewed: shown('a'), own: settleOwnChange({ message: 'Saved. Fix the pick errors to build the candidate.', candidateManifestId: null }) };
    expect(reconcile(done, shown(null))).toEqual(reviewing(shown(null)));
  });

  it('holds approving when an export of the same candidate changes', () => {
    const review = reviewing(shown('a', '2026-10-17T10:00:00.000Z'));
    const swapped = shown('a', '2026-10-17T10:05:00.000Z');
    expect(reviewChanged(review, swapped)).toBe(true);
    expect(exportsMoved(review, swapped)).toBe(true);
    expect(reviewChanged(review, shown('a', '2026-10-17T10:00:00.000Z'))).toBe(false);
  });
});
