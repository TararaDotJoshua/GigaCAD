import { execFile } from 'node:child_process';
import { constants, existsSync, readFileSync } from 'node:fs';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
