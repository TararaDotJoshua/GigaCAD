import { expect, test } from '@playwright/test';
import { FIXTURES } from '../src/renderer/preview/fixtures.js';

// The default window and the smallest one the app allows (main/controller.ts).
const SIZES = [
  { width: 1120, height: 740 },
  { width: 860, height: 560 },
];

for (const platform of ['darwin', 'win32'] as const) {
  for (const size of SIZES) {
    for (const fixture of FIXTURES) {
      test(`${fixture.name} · ${platform} · ${size.width}×${size.height}`, async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
        page.on('pageerror', (error) => errors.push(error.message));
        await page.setViewportSize(size);
        await page.goto(`/preview/?fixture=${fixture.name}&platform=${platform}`);
        await page.locator('#root > *').first().waitFor({ timeout: 10_000 });
        if (fixture.tab) await page.getByRole('tab', { name: fixture.tab }).click();
        if (fixture.press) {
          await page.getByRole('button', { name: fixture.press }).click();
          await expect(page.locator('.popover')).toBeVisible();
        }
        // Data loads through the fake bridge on the next tick.
        await page.waitForTimeout(100);
        await page.screenshot({ path: `test-results/layout/${platform}/${size.width}x${size.height}/${fixture.name}.png` });

        const layout = await page.evaluate(() => {
          const box = (element: Element) => element.getBoundingClientRect();
          // An open popover must fit in the window.
          const popover = document.querySelector('.popover');
          const offscreen = popover && (box(popover).left < 0 || box(popover).right > innerWidth || box(popover).bottom > innerHeight) ? ['popover'] : [];
          const overflowing = [...document.querySelectorAll('body, .app, .main, .content, .sidebar, .toolbar')]
            .filter((element) => element.scrollWidth > element.clientWidth + 1)
            .map((element) => element.className || element.tagName)
            .concat(offscreen);
          const toolbar = document.querySelector('.toolbar');
          const title = document.querySelector('.toolbar-title');
          // Nothing in the toolbar may reach into its padding: on Windows that's under the caption buttons.
          const clipped = toolbar
            ? [...toolbar.children]
                .filter((child) => box(child).right > box(toolbar).right - parseFloat(getComputedStyle(toolbar).paddingRight) + 1)
                .map((child) => child.className)
            : [];
          // Names in lists cut down to a few letters (or nothing) are unreadable.
          const squeezed = [...document.querySelectorAll('.rows > li > .strong, .rows > li > .grow')]
            .filter((element) => element.textContent && (box(element).width < 1 || (element.scrollWidth > element.clientWidth + 1 && box(element).width < 96)))
            .map((element) => `${element.textContent} (${Math.round(box(element).width)} px)`);
          // The current place in the breadcrumb, cut to a few letters.
          const current = document.querySelector('.crumb.is-current');
          if (current && current.scrollWidth > current.clientWidth + 1 && box(current).width < 96) squeezed.push(`${current.textContent} (${Math.round(box(current).width)} px)`);
          // Rows in one list share a height, whether or not they have a button.
          const unevenLists = [...document.querySelectorAll('.rows:not(.nested)')]
            .map((list) => [...new Set([...list.children].filter((row) => !row.querySelector('.rows')).map((row) => Math.round(box(row).height)))])
            .filter((heights) => heights.length > 1);
          const update = document.querySelector('.update');
          return {
            overflowing,
            clipped,
            toolbarHeight: toolbar ? Math.round(box(toolbar).height) : null,
            titleWidth: title ? Math.round(box(title).width) : null,
            squeezed,
            unevenLists,
            updateHeight: update ? Math.round(box(update).height) : null,
          };
        });

        expect.soft(errors, 'console errors').toEqual([]);
        expect.soft(layout.overflowing, 'horizontal overflow').toEqual([]);
        expect.soft(layout.clipped, 'toolbar items past its padding').toEqual([]);
        if (layout.toolbarHeight !== null) expect.soft(layout.toolbarHeight, 'toolbar height').toBeLessThanOrEqual(52);
        if (layout.titleWidth !== null) expect.soft(layout.titleWidth, 'toolbar title width').toBeGreaterThanOrEqual(120);
        expect.soft(layout.squeezed, 'names cut below 96 px').toEqual([]);
        expect.soft(layout.unevenLists, 'row heights within a list').toEqual([]);
        if (layout.updateHeight !== null && size.height < 640) expect.soft(layout.updateHeight, 'update banner on a short window').toBeLessThanOrEqual(48);
      });
    }
  }
}
