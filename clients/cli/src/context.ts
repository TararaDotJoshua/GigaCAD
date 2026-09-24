import { spawn } from 'node:child_process';
import { hostname, homedir } from 'node:os';

export interface OutputStream {
  write(text: string): unknown;
  readonly isTTY?: boolean | undefined;
}

/** Everything the CLI takes from the process, so tests can run commands in-process with their own values. */
export interface Context {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  readonly platform: NodeJS.Platform;
  readonly homedir: string;
  readonly hostname: string;
  readonly openBrowser: (url: string) => Promise<void>;
  readonly sleep: (ms: number) => Promise<void>;
}

export function processContext(): Context {
  return {
    env: process.env,
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
    platform: process.platform,
    homedir: homedir(),
    hostname: hostname(),
    openBrowser: (url) => openBrowser(url, process.platform),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/** Best effort: a missing opener just means the user follows the printed link. */
async function openBrowser(url: string, platform: NodeJS.Platform): Promise<void> {
  const [command, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  await new Promise<void>((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => resolve());
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
