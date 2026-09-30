import { execFile } from 'node:child_process';
import { constants, existsSync, readFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const SHIM_PATH = '/usr/local/bin/giga';
const SHIM_MARKER = '# Installed by GigaCAD';

/** The .app bundle this process runs from, e.g. /Applications/GigaCAD.app, or undefined in development. */
export function appBundlePath(execPath = process.execPath): string | undefined {
  const match = execPath.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/);
  return match?.[1];
}

/** `giga` for the terminal, run by the app's own binary acting as Node: no Node install needed. */
export function shimScript(app: string): string {
  const binary = join(app, 'Contents', 'MacOS', 'GigaCAD');
  const launcher = join(app, 'Contents', 'Resources', 'cli-launcher.cjs');
  return `#!/bin/sh
${SHIM_MARKER}. It runs giga with GigaCAD's own copy of Node, so giga updates with the app.
exec env ELECTRON_RUN_AS_NODE=1 "${binary}" "${launcher}" "$@"
`;
}

export const isOurShim = (path: string) => existsSync(path) && readFileSync(path, 'utf8').includes(SHIM_MARKER);

/** The `giga` a new Terminal window would run (from a login shell's PATH), if any. */
export async function terminalGiga(): Promise<string | null> {
  try {
    const { stdout } = await run('/bin/zsh', ['-lc', 'command -v giga'], { timeout: 10_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Writes /usr/local/bin/giga, creating /usr/local/bin if needed (it's missing on new Apple
 * silicon Macs). Asks for an administrator password when the folder isn't writable.
 */
export async function installCli(): Promise<{ path: string; terminalUses: string | null }> {
  const app = appBundlePath();
  if (!app) throw new Error('The command line tool can only be installed from the installed GigaCAD app.');
  const script = shimScript(app);
  const writable = await access(dirname(SHIM_PATH), constants.W_OK).then(() => true, () => false);
  if (writable) {
    await writeFile(SHIM_PATH, script, { mode: 0o755 });
  } else {
    const temp = await mkdtemp(join(tmpdir(), 'gigacad-cli-'));
    try {
      const staged = join(temp, 'giga');
      await writeFile(staged, script, { mode: 0o755 });
      const shell = `/bin/mkdir -p /usr/local/bin && /bin/cp '${staged}' '${SHIM_PATH}' && /bin/chmod 755 '${SHIM_PATH}'`;
      await run('/usr/bin/osascript', ['-e', `do shell script "${shell}" with prompt "GigaCAD wants to install the giga command line tool." with administrator privileges`]);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  return { path: SHIM_PATH, terminalUses: await terminalGiga() };
}

// --- Windows -------------------------------------------------------------------------------

const CMD_MARKER = 'rem Installed by GigaCAD';

/** Where giga.cmd goes: a folder of GigaCAD's own, added to the user's PATH. */
export const windowsShimDir = (supportDir: string) => join(supportDir, 'bin');

/** giga.cmd: runs the CLI with GigaCAD's own copy of Node, like the macOS shim. */
export function cmdShim(exe: string, launcher: string): string {
  return [
    '@echo off',
    `${CMD_MARKER}. It runs giga with GigaCAD's own copy of Node, so giga updates with the app.`,
    'setlocal',
    'set ELECTRON_RUN_AS_NODE=1',
    `"${exe}" "${launcher}" %*`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
}

export const isOurCmdShim = (path: string) => existsSync(path) && readFileSync(path, 'utf8').includes(CMD_MARKER);

/**
 * Adds `dir` to the user's PATH (HKCU\Environment) unless it's there, keeping the value's
 * %VARIABLES% unexpanded, then tells running programs the environment changed so new terminals
 * see it. `valueName` is only changed by tests.
 */
export const ADD_TO_PATH_SCRIPT = `
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
$path = [string]$key.GetValue($env:GIGACAD_PATH_VALUE, '', 'DoNotExpandEnvironmentNames')
$parts = @($path -split ';' | Where-Object { $_ -ne '' })
if ($parts -notcontains $env:GIGACAD_BIN) {
  $key.SetValue($env:GIGACAD_PATH_VALUE, (@($parts) + $env:GIGACAD_BIN) -join ';', 'ExpandString')
}
$key.Close()
[Environment]::SetEnvironmentVariable('GIGACAD_PATH_REFRESH', $null, 'User')
`;

export async function addToUserPath(dir: string, valueName = 'Path'): Promise<void> {
  const powershell = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ADD_TO_PATH_SCRIPT], {
    env: { ...process.env, GIGACAD_BIN: dir, GIGACAD_PATH_VALUE: valueName },
    windowsHide: true,
    timeout: 30_000,
  });
}

/** The giga a new terminal would run: the first on PATH, from `where`. */
export async function windowsTerminalGiga(): Promise<string | null> {
  try {
    const { stdout } = await run(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\where.exe`, ['giga'], { windowsHide: true, timeout: 10_000 });
    return stdout.split(/\r?\n/).find(Boolean)?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Writes giga.cmd next to GigaCAD's data and puts its folder on the user's PATH. */
export async function installWindowsCli(supportDir: string, exe = process.execPath, resourcesPath = process.resourcesPath): Promise<{ path: string; terminalUses: string | null }> {
  const dir = windowsShimDir(supportDir);
  const shim = join(dir, 'giga.cmd');
  await mkdir(dir, { recursive: true });
  await writeFile(shim, cmdShim(exe, join(resourcesPath, 'cli-launcher.cjs')));
  // Asked before the PATH changes (this process's PATH is from launch): any giga found now is
  // another one, and it comes first, since GigaCAD's folder goes at the end.
  const other = await windowsTerminalGiga();
  await addToUserPath(dir);
  return { path: shim, terminalUses: other ?? shim };
}

