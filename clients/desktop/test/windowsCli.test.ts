import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addToUserPath, cmdShim, isOurCmdShim } from '../src/main/cliInstall.js';

describe('giga.cmd', () => {
  it('runs the launcher with GigaCAD as Node, passing arguments and the exit code through', () => {
    const shim = cmdShim('C:\\Program Files\\GigaCAD\\GigaCAD.exe', 'C:\\Program Files\\GigaCAD\\resources\\cli-launcher.cjs');
    expect(shim.split('\r\n')).toEqual([
      '@echo off',
      "rem Installed by GigaCAD. It runs giga with GigaCAD's own copy of Node, so giga updates with the app.",
      'setlocal',
      'set ELECTRON_RUN_AS_NODE=1',
      '"C:\\Program Files\\GigaCAD\\GigaCAD.exe" "C:\\Program Files\\GigaCAD\\resources\\cli-launcher.cjs" %*',
      'exit /b %ERRORLEVEL%',
      '',
    ]);
  });
});

describe.runIf(process.platform === 'win32')('giga.cmd on Windows', () => {
  let dir: string | undefined;
  const testValue = `GigaCADTestPath${process.pid}`;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    try {
      execFileSync('reg.exe', ['delete', 'HKCU\\Environment', '/v', testValue, '/f']);
    } catch {
      // Already gone.
    }
  });

  it('runs a launcher with the arguments and exit code intact', () => {
    dir = mkdtempSync(join(tmpdir(), 'gigacad-cmd-'));
    const launcher = join(dir, 'launcher.cjs');
    writeFileSync(launcher, 'console.log(JSON.stringify({ args: process.argv.slice(2), node: process.env.ELECTRON_RUN_AS_NODE })); process.exit(3);');
    const shim = join(dir, 'giga.cmd');
    writeFileSync(shim, cmdShim(process.execPath, launcher));
    expect(isOurCmdShim(shim)).toBe(true);

    let output = '';
    let status = 0;
    try {
      execFileSync('cmd.exe', ['/d', '/c', shim, 'status', '--json', 'a b'], { encoding: 'utf8' });
    } catch (error) {
      output = String((error as { stdout: string }).stdout);
      status = (error as { status: number }).status;
    }
    expect(status).toBe(3);
    expect(JSON.parse(output)).toEqual({ args: ['status', '--json', 'a b'], node: '1' });
  });

  it('adds its folder to a PATH value once, keeping variables unexpanded', async () => {
    execFileSync('reg.exe', ['add', 'HKCU\\Environment', '/v', testValue, '/t', 'REG_EXPAND_SZ', '/d', '%USERPROFILE%\\bin;C:\\tools', '/f']);
    await addToUserPath('C:\\Users\\alex\\AppData\\Local\\GigaCAD\\bin', testValue);
    await addToUserPath('C:\\Users\\alex\\AppData\\Local\\GigaCAD\\bin', testValue);
    const value = execFileSync('reg.exe', ['query', 'HKCU\\Environment', '/v', testValue], { encoding: 'utf8' });
    expect(value).toContain('REG_EXPAND_SZ');
    expect(value).toContain('%USERPROFILE%\\bin;C:\\tools;C:\\Users\\alex\\AppData\\Local\\GigaCAD\\bin');
    expect(value.match(/GigaCAD\\bin/g)).toHaveLength(1);
  }, 60_000);
});
