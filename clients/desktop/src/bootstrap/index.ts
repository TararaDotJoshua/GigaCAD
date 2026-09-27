// The app's entry point. It stays tiny and changes only with a new DMG: it picks the newest
// verified code bundle (see select.ts) and hands over to it. Everything else is in the bundle.
import { app, dialog } from 'electron';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { bundlesDir } from '../shared/runtime.js';
import { PUBLIC_KEY } from './publicKey.js';
import { chooseBundle, clearRollbackNotice, markHealthy } from './select.js';
import { SHELL_VERSION } from './shell.js';

const dir = bundlesDir();
// `pnpm dev` runs the freshly built bundle directly; a packaged app never does.
const devBundle = !app.isPackaged ? process.env.GIGACAD_DEV_BUNDLE : undefined;
const choice = devBundle
  ? { dir: devBundle, version: '0.0.0-dev', source: 'dev' as const, rolledBackFrom: undefined }
  : chooseBundle({ bundlesDir: dir, builtInDir: join(process.resourcesPath, 'app-bundle'), shellVersion: SHELL_VERSION, publicKey: PUBLIC_KEY });

if (!choice) {
  void app.whenReady().then(() => {
    dialog.showErrorBox('GigaCAD can’t start', 'This copy of GigaCAD is damaged. Download it again from gigacad.site.');
    app.quit();
  });
} else {
  let healthy = false;
  globalThis.__gigacad = {
    dir: choice.dir,
    version: choice.version,
    source: choice.source,
    shellVersion: SHELL_VERSION,
    bundlesDir: dir,
    publicKey: PUBLIC_KEY,
    rolledBackFrom: choice.rolledBackFrom,
    markHealthy: () => {
      if (healthy || choice.source === 'dev') return;
      healthy = true;
      markHealthy(dir, choice.version);
    },
    clearRollbackNotice: () => clearRollbackNotice(dir),
  };
  createRequire(__filename)(join(choice.dir, 'main', 'index.cjs'));
}
