// `pnpm dev`: builds once, then watches. Main and preload rebuild with esbuild and restart
// Electron; the window reloads itself from the Vite dev server on port 5178.
//
// The bootstrap runs out/bundle directly (GIGACAD_DEV_BUNDLE), so nothing is verified or
// installed into Application Support's bundles folder. Arguments after `--` go to Electron,
// e.g. `pnpm dev -- --remote-debugging-port=9222`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { context } from 'esbuild';
import { createServer } from 'vite';
import { bundleOut, nodeBuild, pkg, root, shellOut } from './lib.mjs';

const RENDERER_URL = 'http://localhost:5178';

// The shell, the CLI, and icons: a full build without the renderer (the dev server serves it).
await new Promise((resolve, reject) => {
  const build = spawn(process.execPath, [join(root, 'scripts', 'build.mjs'), '--skip-renderer'], { stdio: 'inherit' });
  build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build exited with ${code}`))));
});

const server = await createServer({ configFile: join(root, 'vite.config.ts') });
await server.listen();
console.log(`Renderer at ${RENDERER_URL}`);

const electron = createRequire(import.meta.url)('electron');
let app;
let restarting = false;

function start() {
  app = spawn(electron, [...process.argv.slice(2).filter((arg) => arg !== '--'), join(shellOut, 'bootstrap.cjs')], {
    stdio: 'inherit',
    env: { ...process.env, GIGACAD_DEV_BUNDLE: bundleOut, GIGACAD_RENDERER_URL: RENDERER_URL },
  });
  app.on('exit', (code) => {
    if (restarting) return;
    // Quitting the app ends `pnpm dev`.
    void shutdown(code ?? 0);
  });
}

function restart() {
  if (!app) return start();
  restarting = true;
  app.once('exit', () => {
    restarting = false;
    start();
  });
  app.kill('SIGTERM');
}

let ready = 0;
const onRebuild = {
  name: 'restart-electron',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      // Start once both main and preload are built; after that, any rebuild restarts.
      if (ready < 2) {
        if (++ready === 2) start();
        return;
      }
      console.log('Restarting GigaCAD…');
      restart();
    });
  },
};

const define = { __GIGACAD_VERSION__: JSON.stringify(pkg.version) };
const contexts = await Promise.all([
  context({ ...nodeBuild, entryPoints: [join(root, 'src/main/index.ts')], outfile: join(bundleOut, 'main', 'index.cjs'), define, plugins: [onRebuild] }),
  context({ ...nodeBuild, entryPoints: [join(root, 'src/preload/index.ts')], outfile: join(bundleOut, 'preload', 'index.cjs'), sourcemap: false, plugins: [onRebuild] }),
]);
await Promise.all(contexts.map((ctx) => ctx.watch()));

async function shutdown(code) {
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
  await server.close();
  process.exit(code);
}
process.on('SIGINT', () => {
  restarting = true;
  app?.kill('SIGTERM');
  void shutdown(0);
});
