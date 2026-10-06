import { describe, expect, it } from 'vitest';
import { billingReturnUrl } from './billing.js';

describe('billingReturnUrl', () => {
  it('keeps the page someone came from', () => {
    expect(billingReturnUrl('https://app.gigacad.site', { checkout: 'done' }, '/sam/bracket')).toBe(
      'https://app.gigacad.site/settings/billing?checkout=done&from=%2Fsam%2Fbracket',
    );
  });

  it('drops anything that could leave the site', () => {
    for (const from of ['//evil.example', 'https://evil.example', '/\\evil.example', '/a\nb']) {
      expect(billingReturnUrl('https://app.gigacad.site', {}, from)).toBe('https://app.gigacad.site/settings/billing');
    }
  });
});
