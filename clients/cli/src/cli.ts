import { Command, CommanderError } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerExportCommands } from './commands/exports.js';
import { registerProjectCommands } from './commands/projects.js';
import { registerReleaseRequestCommands } from './commands/releaseRequests.js';
import { registerReleaseCommands } from './commands/releases.js';
import { registerWorkspaceCommands } from './commands/workspace.js';
import type { Context } from './context.js';
import { Output } from './output.js';
import { openSession, type Session } from './session.js';
import { findWorkspace, type Workspace } from './workspace.js';

declare const __GIGA_VERSION__: string | undefined;
export const VERSION = typeof __GIGA_VERSION__ === 'string' ? __GIGA_VERSION__ : '0.0.0-dev';

/** What every command handler gets: the process context, output, and lazy access to the workspace and API. */
export class Runtime {
  private workspacePromise: Promise<Workspace | undefined> | undefined;

  constructor(
    readonly ctx: Context,
    readonly out: Output,
    private readonly apiUrlFlag: string | undefined,
  ) {}

  /** The workspace containing the current directory, if any. */
  workspace(): Promise<Workspace | undefined> {
    this.workspacePromise ??= findWorkspace(this.ctx.cwd);
    return this.workspacePromise;
  }

  /** An API session. Inside a workspace it talks to the API the workspace was cloned from. */
  async session(options: { ignoreWorkspace?: boolean } = {}): Promise<Session> {
    const workspace = options.ignoreWorkspace ? undefined : await this.workspace();
    return openSession(this.ctx, { apiUrlFlag: this.apiUrlFlag, workspaceApiUrl: workspace?.state.apiUrl });
  }
}

/** Wraps a handler so errors print consistently and set the exit code instead of throwing. */
export type Bind = <A extends unknown[]>(handler: (rt: Runtime, ...args: A) => Promise<void>) => (...args: unknown[]) => Promise<void>;

interface GlobalOptions {
  readonly json?: boolean;
  readonly apiUrl?: string;
}

export function buildProgram(ctx: Context, state: { exitCode: number }): Command {
  const program = new Command('giga');
  program
    .description('Version CAD files with GigaCAD: sign in, clone a branch, commit versions, and release.')
    .version(VERSION, '-v, --version', 'Print the giga version')
    .option('--json', 'Print results as JSON (errors go to stderr as JSON)')
    .option('--api-url <url>', 'GigaCAD API to use (default: GIGA_API_URL, the workspace’s API, or https://api.gigacad.site)')
    .helpOption('-h, --help', 'Show help')
    .helpCommand('help [command]', 'Show help for a command')
    .showHelpAfterError('(run `giga --help` for usage)')
    .exitOverride()
    .configureOutput({
      writeOut: (text) => ctx.stdout.write(text),
      writeErr: (text) => ctx.stderr.write(text),
    })
    .addHelpText(
      'after',
      `
Get started:
  giga login
  giga project create robot-arm
  giga branch create dev --project <you>/robot-arm
  giga clone <you>/robot-arm --branch dev
  cd robot-arm && giga checkout
  giga commit -m "First version"

Environment:
  GIGA_API_URL     API to use, e.g. http://127.0.0.1:8787 for local development
  GIGA_TOKEN       Device token for CI; used instead of the saved sign-in, never saved
  GIGA_CONFIG_DIR  Where sign-ins are saved (default: your user config folder)`,
    );

  const bind: Bind =
    (handler) =>
    async (...args) => {
      const command = args.at(-1) as Command;
      const globals = command.optsWithGlobals<GlobalOptions>();
      const out = new Output(ctx, globals.json === true);
      try {
        await handler(new Runtime(ctx, out, globals.apiUrl), ...(args.slice(0, -1) as never));
      } catch (error) {
        out.error(error);
        state.exitCode = 1;
      }
    };

  registerAuthCommands(program, bind);
  registerProjectCommands(program, bind);
  registerWorkspaceCommands(program, bind);
  registerExportCommands(program, bind);
  registerReleaseRequestCommands(program, bind);
  registerReleaseCommands(program, bind);
  return program;
}

/** Runs one giga command line and returns the exit code. */
export async function run(argv: readonly string[], ctx: Context): Promise<number> {
  const state = { exitCode: 0 };
  const program = buildProgram(ctx, state);
  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    new Output(ctx, argv.includes('--json')).error(error);
    return 1;
  }
  return state.exitCode;
}
