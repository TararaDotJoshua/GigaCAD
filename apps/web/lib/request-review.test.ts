import { describe, expect, it } from 'vitest';
import { candidateChanged, reconcile, settleOwnChange, type Review } from './request-review';

const reviewing = (reviewedId: string | null): Review => ({ reviewedId, own: null });

describe('the candidate under review', () => {
  it('moves to the candidate the viewer’s own action built', () => {
    const running: Review = { reviewedId: 'a', own: 'running' };
    // The candidate is cleared and rebuilt while the action runs; nothing is flagged meanwhile.
    expect(candidateChanged(running, null)).toBe(false);
    const done = { ...running, own: settleOwnChange({ message: 'Built the candidate.', candidateManifestId: 'b' }) };
    expect(reconcile(done, 'b')).toEqual(reviewing('b'));
  });

  it('doesn’t adopt someone else’s candidate after the viewer’s own action failed', () => {
    const failed: Review = { reviewedId: 'a', own: settleOwnChange({ error: 'That didn’t go through.' }) };
    const later = reconcile(failed, 'foreign');
    expect(later.reviewedId).toBe('a');
    expect(candidateChanged(later, 'foreign')).toBe(true);
  });

  it('doesn’t adopt a different candidate than the one the viewer’s action built', () => {
    const done: Review = { reviewedId: 'a', own: settleOwnChange({ candidateManifestId: 'mine' }) };
    expect(reconcile(done, 'foreign')).toEqual(done);
    expect(candidateChanged(reconcile(done, 'foreign'), 'foreign')).toBe(true);
  });

  it('accepts a save that left no candidate', () => {
    const done: Review = { reviewedId: 'a', own: settleOwnChange({ message: 'Saved. Fix the pick errors to build the candidate.', candidateManifestId: null }) };
    expect(reconcile(done, null)).toEqual(reviewing(null));
  });
});
