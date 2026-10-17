import { describe, expect, it } from 'vitest';
import { FIELD_OF_VIEW, FIT_PADDING, fitDistance } from './viewer-camera';

const halfAngle = (FIELD_OF_VIEW * Math.PI) / 360;

describe('fitDistance', () => {
  it('fits a square stage to the vertical field of view, with padding', () => {
    expect(fitDistance(10, 1)).toBeCloseTo((FIT_PADDING * 10) / Math.sin(halfAngle));
    expect(fitDistance(10, 1, FIELD_OF_VIEW, 1)).toBeCloseTo(10 / Math.sin(halfAngle));
  });

  it('keeps the vertical fit on wide stages', () => {
    expect(fitDistance(10, 2.4)).toBeCloseTo(fitDistance(10, 1));
  });

  it('moves back on portrait stages, so wide models fit across', () => {
    const portrait = fitDistance(10, 0.5);
    expect(portrait).toBeGreaterThan(fitDistance(10, 1));
    // The model's sphere then just fits the horizontal half-angle, with the same padding.
    const horizontal = Math.atan(Math.tan(halfAngle) * 0.5);
    expect(portrait).toBeCloseTo((FIT_PADDING * 10) / Math.sin(horizontal));
  });

  it('treats a stage with no size as square', () => {
    expect(fitDistance(10, 0)).toBeCloseTo(fitDistance(10, 1));
    expect(fitDistance(10, Number.NaN)).toBeCloseTo(fitDistance(10, 1));
  });
});
