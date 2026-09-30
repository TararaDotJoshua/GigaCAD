import { hostname, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

export const PIPE_PREFIX = 'GigaCAD.Host.';

/** Same as `PipeNames.ForUser` in the C# protocol library: the add-in computes the name on its side. */
export function pipeNameFor(domain: string, user: string): string {
  let name = PIPE_PREFIX;
  for (const c of `${domain}.${user}`.toLowerCase()) name += /[\p{L}\p{Nd}.-]/u.test(c) ? c : '_';
  return name;
}

/** The app's pipe name for the signed-in user. On Windows .NET's `Environment.UserDomainName` is `USERDOMAIN`. */
export function currentPipeName(env: NodeJS.ProcessEnv = process.env): string {
  return pipeNameFor(env.USERDOMAIN ?? hostname(), userInfo().username);
}

/**
 * Where a pipe name lives. On Windows it's a named pipe. Elsewhere it's the Unix socket .NET's
 * `NamedPipeClientStream` looks for, so the C# client can reach the app in tests on any OS.
 */
export function pipePath(name: string, platform: NodeJS.Platform = process.platform, tempDir: string = tmpdir()): string {
  return platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tempDir, `CoreFxPipe_${name}`);
}
