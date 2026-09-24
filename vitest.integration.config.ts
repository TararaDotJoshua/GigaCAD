import { defineConfig } from 'vitest/config';
import { alias } from './vitest.config.js';

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['**/*.int.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
