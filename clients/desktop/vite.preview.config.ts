import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import app from './vite.config.js';

// `pnpm preview`: the window in a browser with a fake bridge and sample states
// (src/renderer/preview). Open http://localhost:5179/preview/?fixture=project&platform=win32.
export default mergeConfig(
  app,
  defineConfig({
    root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
    server: { port: 5179, strictPort: true },
    build: { outDir: fileURLToPath(new URL('./out/preview', import.meta.url)) },
  }),
);
