import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { QUICK_ACTIONS } from './quickActions.js';

const run = promisify(execFile);

/**
 * File Explorer's right-click menu on Windows: a GigaCAD submenu with the same actions as the
 * macOS Quick Actions. Each entry runs `GigaCAD.exe --action <action> "<path>"` (launchArgs.ts).
 *
 * It lives in HKEY_CURRENT_USER\Software\Classes, so no administrator is needed, and AppliesTo
 * limits it to items inside the GigaCAD folder. On Windows 11 it's under "Show more options".
 */

/** The keys the menu is written under: files, folders, and a folder's background. */
export const MENU_KEYS = [
  'HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\GigaCAD',
  'HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\GigaCAD',
  'HKEY_CURRENT_USER\\Software\\Classes\\Directory\\Background\\shell\\GigaCAD',
] as const;

/** Stored on each menu key, so a newer app (or a moved GigaCAD folder) knows to rewrite it. */
const STAMP_VALUE = 'GigaCADStamp';

export interface MenuOptions {
  /** GigaCAD.exe. */
  readonly exe: string;
  /** The GigaCAD folder; the menu only shows inside it. */
  readonly folder: string;
  readonly version: string;
}

export const menuStamp = ({ exe, folder, version }: MenuOptions) => `${version}|${exe}|${folder}`;

/** A .reg value string: backslashes and quotes escaped. */
const regString = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * The .reg file that installs the menu. `%1` is the clicked item; on a folder's background it's
 * `%V`, the folder itself. AppliesTo is an Advanced Query Syntax condition: `~<` means "starts with".
 */
export function menuRegFile(options: MenuOptions): string {
  const folder = options.folder.replace(/[\\/]+$/, '');
  const appliesTo = `System.ItemPathDisplay:~<"${folder}"`;
  const lines = ['Windows Registry Editor Version 5.00', ''];
  for (const key of MENU_KEYS) {
    const item = key.includes('\\Background\\') ? '%V' : '%1';
    lines.push(
      `[${key}]`,
      `"MUIVerb"="GigaCAD"`,
      `"SubCommands"=""`,
      `"Icon"=${regString(`${options.exe},0`)}`,
      `"AppliesTo"=${regString(appliesTo)}`,
      `"${STAMP_VALUE}"=${regString(menuStamp(options))}`,
      '',
    );
    QUICK_ACTIONS.forEach(({ title, action }, index) => {
      // Numbered keys keep the menu in the same order as the Quick Actions.
      const verb = `${key}\\shell\\${String(index + 1).padStart(2, '0')}-${action}`;
      lines.push(
        `[${verb}]`,
        `"MUIVerb"=${regString(title)}`,
        '',
        `[${verb}\\command]`,
        `@=${regString(`"${options.exe}" --action ${action} "${item}"`)}`,
        '',
      );
    });
  }
  return lines.join('\r\n');
}

const reg = (args: string[]) => run(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\reg.exe`, args, { windowsHide: true });

/** Whether this version's menu is in place for this GigaCAD folder. */
export async function explorerMenuInstalled(options: MenuOptions): Promise<boolean> {
  const expected = menuStamp(options);
  for (const key of MENU_KEYS) {
    try {
      const { stdout } = await reg(['query', key, '/v', STAMP_VALUE]);
      if (!stdout.includes(expected)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Replaces the menu: removes the old keys (so renamed actions don't linger), then imports the new ones. */
export async function installExplorerMenu(options: MenuOptions): Promise<void> {
  await removeExplorerMenu();
  const dir = await mkdtemp(join(tmpdir(), 'gigacad-menu-'));
  try {
    const file = join(dir, 'menu.reg');
    // reg import reads UTF-16 with a BOM, so any path works.
    await writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(menuRegFile(options), 'utf16le')]));
    await reg(['import', file]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function removeExplorerMenu(): Promise<void> {
  for (const key of MENU_KEYS) await reg(['delete', key, '/f']).catch(() => undefined);
}
