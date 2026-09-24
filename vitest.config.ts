import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export const alias = {
  '@gigacad/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
};

// Unit tests. Integration tests (*.int.test.ts) need `supabase start`; run them with `pnpm test:integration`.
export default defineConfig({
  resolve: { alias },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.test.ts'],
  },
});
