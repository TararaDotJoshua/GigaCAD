// Pre-renders every known Finder icon into build/icons/ (folders at 512 px, files at 256 px),
// the menu bar template icon, the Windows tray icon, and the app icon (build/app-icon.png) for electron-builder.
// Needs macOS: it uses the system's own SVG renderer through osascript, like the app does.
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iconsBuild, importTs, root } from './lib.mjs';

if (process.platform !== 'darwin') {
  console.error('Icons are rendered with macOS’s SVG renderer; run this on a Mac.');
  process.exit(1);
}

const { prerenderedKeys, iconPixels, isFolderIcon } = await importTs('src/main/iconArt.ts');
const { renderIcons } = await importTs('src/main/icons.ts');
const { pngToIco, ICO_SIZES } = await importTs('src/main/ico.ts');

rmSync(iconsBuild, { recursive: true, force: true });
const keys = prerenderedKeys();
const result = await renderIcons(keys, iconsBuild, iconPixels);
if (result.failed.length > 0) throw new Error(`Couldn't render: ${result.failed.join(', ')}`);

// The menu bar icon is a template image: macOS tints it for light and dark menu bars. One per
// sync state (trayTemplate.png is the idle one), and the Windows tray's colored ones.
const { TRAY_STATES } = await importTs('src/main/iconArt.ts');
for (const state of TRAY_STATES) {
  const suffix = state === 'idle' ? '' : `-${state}`;
  for (const [pixels, scale] of [[16, ''], [32, '@2x']]) {
    const temp = mkdtempSync(join(tmpdir(), 'gigacad-tray-'));
    await renderIcons([`tray-${state}`, `trayWin-${state}`], temp, () => pixels);
    renameSync(join(temp, `tray-${state}.png`), join(iconsBuild, `trayTemplate${suffix}${scale}.png`));
    renameSync(join(temp, `trayWin-${state}.png`), join(iconsBuild, `trayWin${suffix}${scale}.png`));
    rmSync(temp, { recursive: true, force: true });
  }
}
{
  const temp = mkdtempSync(join(tmpdir(), 'gigacad-overlay-'));
  await renderIcons(['overlay'], temp, () => 32);
  renameSync(join(temp, 'overlay.png'), join(iconsBuild, 'overlay.png'));
  rmSync(temp, { recursive: true, force: true });
}

// Windows folder icons (desktop.ini) need .ico files, one per folder icon, at the sizes File
// Explorer asks for. Windows can't give single files their own icons, so only folders get them.
const folderKeys = keys.filter((key) => isFolderIcon(key));
const renders = [];
for (const size of ICO_SIZES) {
  const temp = mkdtempSync(join(tmpdir(), `gigacad-ico-${size}-`));
  const result = await renderIcons(folderKeys, temp, () => size);
  if (result.failed.length > 0) throw new Error(`Couldn't render at ${size} px: ${result.failed.join(', ')}`);
  renders.push({ size, temp });
}
for (const key of folderKeys) {
  const images = renders.map(({ size, temp }) => ({ size, png: readFileSync(join(temp, `${key}.png`)) }));
  writeFileSync(join(iconsBuild, `${key}.ico`), pngToIco(images));
}
for (const { temp } of renders) rmSync(temp, { recursive: true, force: true });

const temp = mkdtempSync(join(tmpdir(), 'gigacad-app-'));
await renderIcons(['app'], temp, () => 1024);
renameSync(join(temp, 'app.png'), join(root, 'build', 'app-icon.png'));
rmSync(temp, { recursive: true, force: true });

console.log(`Rendered ${keys.length} Finder icons, ${folderKeys.length} Windows folder icons, the menu bar and Windows tray icons for each sync state, the taskbar overlay, and the app icon.`);
