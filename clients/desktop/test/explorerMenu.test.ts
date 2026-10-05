import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { explorerMenuInstalled, installExplorerMenu, MENU_KEYS, menuRegFile, removeExplorerMenu } from '../src/main/explorerMenu.js';
import { QUICK_ACTIONS } from '../src/main/quickActions.js';

const options = {
  exe: 'C:\\Users\\alex\\AppData\\Local\\Programs\\gigacad\\GigaCAD.exe',
  folder: 'C:\\Users\\alex\\GigaCAD\\',
  version: '0.2.0',
};

describe('menuRegFile', () => {
  const file = menuRegFile(options);

  it('adds a GigaCAD submenu to files, folders, and folder backgrounds, only inside the GigaCAD folder', () => {
    expect(file.startsWith('Windows Registry Editor Version 5.00\r\n')).toBe(true);
    for (const key of MENU_KEYS) expect(file).toContain(`[${key}]`);
    expect(file).toContain('"SubCommands"=""');
    expect(file).toContain('"AppliesTo"="System.ItemPathDisplay:~<\\"C:\\\\Users\\\\alex\\\\GigaCAD\\""');
    expect(file).toContain('"Icon"="C:\\\\Users\\\\alex\\\\AppData\\\\Local\\\\Programs\\\\gigacad\\\\GigaCAD.exe,0"');
  });

  it('runs GigaCAD.exe with each action, in the Quick Actions order', () => {
    const files = MENU_KEYS[0];
    QUICK_ACTIONS.forEach(({ title, action }, index) => {
      const verb = `${files}\\shell\\${String(index + 1).padStart(2, '0')}-${action}`;
      expect(file).toContain(`[${verb}]\r\n"MUIVerb"="${title}"`);
      expect(file).toContain(`[${verb}\\command]\r\n@="\\"C:\\\\Users\\\\alex\\\\AppData\\\\Local\\\\Programs\\\\gigacad\\\\GigaCAD.exe\\" --action ${action} \\"%1\\""`);
    });
  });

  it('uses the folder itself on a folder background', () => {
    expect(file).toContain(`[${MENU_KEYS[2]}\\shell\\01-checkout\\command]\r\n@="\\"C:\\\\Users\\\\alex\\\\AppData\\\\Local\\\\Programs\\\\gigacad\\\\GigaCAD.exe\\" --action checkout \\"%V\\""`);
  });
});

describe.runIf(process.platform === 'win32')('the menu in the registry', () => {
  afterEach(() => removeExplorerMenu());

  it('installs, is found for this version and folder only, and removes', async () => {
    await installExplorerMenu(options);
    expect(await explorerMenuInstalled(options)).toBe(true);
    expect(await explorerMenuInstalled({ ...options, version: '0.3.0' })).toBe(false);
    expect(await explorerMenuInstalled({ ...options, folder: 'D:\\GigaCAD' })).toBe(false);

    const command = execFileSync('reg.exe', ['query', `${MENU_KEYS[1]}\\shell\\02-checkin\\command`, '/ve'], { encoding: 'utf8' });
    expect(command).toContain(`"${options.exe}" --action checkin "%1"`);

    await removeExplorerMenu();
    expect(await explorerMenuInstalled(options)).toBe(false);
  });
});
