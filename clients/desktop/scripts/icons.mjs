// Pre-renders every known Finder icon into build/icons/ (folders at 512 px, files at 256 px),
// the menu bar template icon, and the app icon (build/app-icon.png) for electron-builder.
// Needs macOS: it uses the system's own SVG renderer through osascript, like the app does.
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iconsBuild, importTs, root } from './lib.mjs';

if (process.platform !== 'darwin') {
  console.error('Icons are rendered with macOS’s SVG renderer; run this on a Mac.');
  process.exit(1);
}

const { prerenderedKeys, iconPixels } = await importTs('src/main/iconArt.ts');
const { renderIcons } = await importTs('src/main/icons.ts');

rmSync(iconsBuild, { recursive: true, force: true });
const keys = prerenderedKeys();
const result = await renderIcons(keys, iconsBuild, iconPixels);
if (result.failed.length > 0) throw new Error(`Couldn't render: ${result.failed.join(', ')}`);

// The menu bar icon is a template image: macOS tints it for light and dark menu bars.
for (const [pixels, name] of [[16, 'trayTemplate.png'], [32, 'trayTemplate@2x.png']]) {
  const temp = mkdtempSync(join(tmpdir(), 'gigacad-tray-'));
  await renderIcons(['tray'], temp, () => pixels);
  renameSync(join(temp, 'tray.png'), join(iconsBuild, name));
  rmSync(temp, { recursive: true, force: true });
}

const temp = mkdtempSync(join(tmpdir(), 'gigacad-app-'));
await renderIcons(['app'], temp, () => 1024);
renameSync(join(temp, 'app.png'), join(root, 'build', 'app-icon.png'));
rmSync(temp, { recursive: true, force: true });

console.log(`Rendered ${keys.length} Finder icons, the menu bar icon, and the app icon.`);
