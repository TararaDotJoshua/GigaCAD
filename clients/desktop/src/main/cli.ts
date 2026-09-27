import { hostname, homedir } from 'node:os';
import { run, type Context } from '@gigacad/cli/lib';
import type { GigaErrorInfo } from '../shared/types.js';

/** A `giga` command failed. `code` is the CLI's stable error code. */
export class GigaError extends Error implements GigaErrorInfo {
  readonly code: string;
  readonly hint: string | undefined;
  readonly details: unknown;

  constructor(info: { code: string; message: string; hint?: string; details?: unknown }) {
    super(info.message);
    this.name = 'GigaError';
    this.code = info.code;
    this.hint = info.hint;
    this.details = info.details;
  }
}

export interface GigaOptions {
  readonly cwd: string;
  readonly apiUrl: string;
  /** Progress and notices (stderr lines), e.g. "Downloading parts/Arm.SLDPRT". */
  readonly onMessage?: ((line: string) => void) | undefined;
  readonly openBrowser?: ((url: string) => Promise<void>) | undefined;
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Runs one `giga` command line in this process with --json and returns its JSON result.
 * It's the same code as the terminal `giga`, with the same saved sign-in and machine name.
 * Commands in the same folder run one at a time.
 */
export function giga<T = unknown>(args: readonly string[], options: GigaOptions): Promise<T> {
  const previous = queues.get(options.cwd) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => runOnce<T>(args, options));
  queues.set(options.cwd, next);
  void next.finally(() => {
    if (queues.get(options.cwd) === next) queues.delete(options.cwd);
  });
  return next;
}

async function runOnce<T>(args: readonly string[], options: GigaOptions): Promise<T> {
  let stdout = '';
  let stderr = '';
  let partial = '';
  const ctx: Context = {
    env: { ...process.env, GIGA_API_URL: options.apiUrl },
    cwd: options.cwd,
    stdout: { write: (text: string) => (stdout += text) },
    stderr: {
      write: (text: string) => {
        stderr += text;
        partial += text;
        const lines = partial.split('\n');
        partial = lines.pop() ?? '';
        // Notices are plain lines; the error document at the end is JSON.
        for (const line of lines) if (line.trim() && !/^[\s{}]/.test(line)) options.onMessage?.(line.trim());
      },
    },
    platform: process.platform,
    homedir: homedir(),
    hostname: hostname(),
    openBrowser: options.openBrowser ?? (async () => undefined),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  const code = await run([...args, '--json'], ctx);
  if (code === 0) return (stdout.trim() ? JSON.parse(stdout) : null) as T;
  throw errorFrom(stderr);
}

/** With --json, a failure ends stderr with a pretty-printed `{ "error": { code, message, hint } }`. */
export function errorFrom(stderr: string): GigaError {
  const start = stderr.lastIndexOf('{\n  "error"');
  if (start >= 0) {
    try {
      const parsed = JSON.parse(stderr.slice(start)) as { error: { code: string; message: string; hint?: string; details?: unknown } };
      return new GigaError(parsed.error);
    } catch {
      // Fall through to the raw text.
    }
  }
  return new GigaError({ code: 'unknown', message: stderr.trim() || 'giga failed' });
}

export const isGigaError = (error: unknown, code?: string): error is GigaError =>
  error instanceof GigaError && (code === undefined || error.code === code);
