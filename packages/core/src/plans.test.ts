import { describe, expect, it } from 'vitest';
import { formatBytes, getPlan, parsePriceLookupKey, PLANS, priceLookupKey } from './plans.js';

describe('plans', () => {
  it('prices yearly billing at ten months', () => {
    for (const plan of PLANS) expect(plan.yearlyUsd).toBe(plan.monthlyUsd * 10);
  });

  it('keeps the free plan at the original 5 GB default', () => {
    expect(getPlan('free').storageBytes).toBe(5368709120);
  });

  it('round-trips price lookup keys and rejects others', () => {
    expect(parsePriceLookupKey(priceLookupKey('workshop', 'yearly'))).toEqual({ plan: 'workshop', interval: 'yearly' });
    expect(parsePriceLookupKey('gigacad_free_monthly')).toBeNull();
    expect(parsePriceLookupKey('gigacad_pro_monthly')).toBeNull();
    expect(parsePriceLookupKey(null)).toBeNull();
  });

  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
    expect(formatBytes(2 * 1024 ** 4)).toBe('2 TB');
    expect(formatBytes(1.44 * 1024 ** 3)).toBe('1.4 GB');
    expect(formatBytes(830 * 1024 ** 2)).toBe('830 MB');
  });
});
