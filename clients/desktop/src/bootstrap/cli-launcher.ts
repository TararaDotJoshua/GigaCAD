// The terminal `giga`: /usr/local/bin/giga runs this with the app's own binary as Node
// (ELECTRON_RUN_AS_NODE=1), so it needs no Node install. It runs the CLI from the bundle the
// app last ran healthily, so the terminal gets over-the-air updates too.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundlesDir } from '../shared/runtime.js';
import { PUBLIC_KEY } from './publicKey.js';
import { currentBundleDir } from './select.js';
import { SHELL_VERSION } from './shell.js';

const dir = currentBundleDir({ bundlesDir: bundlesDir(), builtInDir: join(__dirname, 'app-bundle'), shellVersion: SHELL_VERSION, publicKey: PUBLIC_KEY });
if (!dir) {
  process.stderr.write('error: GigaCAD’s bundled giga is damaged. Reinstall GigaCAD from gigacad.site.\n');
  process.exit(1);
}
void import(pathToFileURL(join(dir, 'cli', 'giga.js')).href);
