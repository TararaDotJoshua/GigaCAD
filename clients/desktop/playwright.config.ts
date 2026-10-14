import { defineConfig, devices } from '@playwright/test';

/**
 * `pnpm --filter @gigacad/desktop layout`: screenshots every preview fixture on macOS and
 * Windows at the default and minimum window sizes, and fails on the layout bugs the
 * 2026-10-07 audit found. Screenshots land in test-results/layout/.
 */
export default defineConfig({
  testDir: './test',
  // Not *.test.ts, so Vitest leaves it alone.
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5179' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } }],
  webServer: { command: 'pnpm preview', url: 'http://localhost:5179/preview/', reuseExistingServer: !process.env.CI },
});
