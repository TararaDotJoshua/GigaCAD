import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against a local stack: `supabase start`, the S3 stand-in, the built API,
 * and the built web app. CI's `e2e` job sets that up; see `.github/workflows/ci.yml`.
 */
const API_DIR = new URL('../api/', import.meta.url).pathname;

export default defineConfig({
  testDir: './e2e',
  // Not *.test.ts or *.spec.ts, so Vitest leaves these files alone.
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node dist/server.js',
      cwd: API_DIR,
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm start',
      url: 'http://localhost:3000/login',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
