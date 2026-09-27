import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The window's UI. It's loaded from the bundle folder with file://, so asset paths are relative.
export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./out/bundle/renderer', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false,
  },
  server: { port: 5178, strictPort: true },
  // Found up front, so the dev server never re-optimizes (and splits React in two) mid-load.
  optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
  oxc: { jsx: { runtime: 'automatic' } },
});
