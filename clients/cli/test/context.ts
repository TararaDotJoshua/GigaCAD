import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import type { Context } from '../src/context.js';

export interface Captured {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout parsed as JSON (for --json runs). */
  json<T = any>(): T;
  /** stderr parsed as JSON (for failed --json runs). */
  errorJson(): { error: { code: string; message: string; hint?: string; details?: unknown; status?: number } };
}

export interface TestCli {
  readonly configDir: string;
  readonly env: Record<string, string | undefined>;
  /** Runs `giga <args>` in-process from `cwd`. */
  run(args: readonly string[], options?: { cwd?: string; env?: Record<string, string | undefined>; onStderr?: (text: string) => void }): Promise<Captured>;
}

export async function tempDir(prefix = 'giga-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** A CLI with its own config folder, as if on its own computer. */
export async function testCli(options: { env?: Record<string, string | undefined>; hostname?: string } = {}): Promise<TestCli> {
  const configDir = await tempDir('giga-config-');
  const env = { GIGA_CONFIG_DIR: configDir, ...options.env };
  return {
    configDir,
    env,
    async run(args, runOptions = {}) {
      let stdout = '';
      let stderr = '';
      const ctx: Context = {
        env: { ...env, ...runOptions.env },
        cwd: runOptions.cwd ?? configDir,
        stdout: { write: (text: string) => (stdout += text) },
        stderr: {
          write: (text: string) => {
            stderr += text;
            runOptions.onStderr?.(text);
          },
        },
        platform: process.platform,
        homedir: configDir,
        hostname: options.hostname ?? 'test-computer.local',
        openBrowser: async () => {},
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 50))),
      };
      const code = await run(args, ctx);
      return {
        code,
        stdout,
        stderr,
        json: () => JSON.parse(stdout),
        errorJson: () => JSON.parse(stderr),
      };
    },
  };
}
