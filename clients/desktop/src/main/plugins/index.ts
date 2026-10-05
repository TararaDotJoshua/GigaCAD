import { currentPipeName, pipePath } from './pipeName.js';
import { PluginPipeServer } from './pipeServer.js';
import { PluginRegistry } from './registry.js';
import { createSolidWorksPlugin } from './solidworks.js';
import type { GigaPlugin, PluginLog } from './types.js';

/**
 * The CAD plugins GigaCAD ships. They're compiled into the signed code bundle, so updates
 * replace them with the rest of the app; nothing is loaded from disk. Add a plugin here.
 */
export function builtInPlugins(platform: NodeJS.Platform = process.platform): GigaPlugin[] {
  return [createSolidWorksPlugin({ platform })];
}

export interface PluginHostOptions {
  readonly hostVersion: string;
  readonly signedInAs: () => string | null;
  readonly log: PluginLog;
  readonly platform?: NodeJS.Platform;
  readonly plugins?: readonly GigaPlugin[];
  /** Defaults to this user's pipe (pipePath(currentPipeName())). */
  readonly pipePath?: string;
  readonly onSessionsChanged?: () => void;
}

export interface PluginHost {
  readonly registry: PluginRegistry;
  /** Call listen() to open the pipe add-ins connect to. */
  readonly server: PluginPipeServer;
}

/**
 * The plugin registry and the add-in pipe. Every add-in method answers not_implemented until
 * the app registers handlers with server.handle() (docs/clients/windows-app-plan.md, milestone W4).
 */
export function createPluginHost(options: PluginHostOptions): PluginHost {
  const platform = options.platform ?? process.platform;
  const registry = new PluginRegistry(options.plugins ?? builtInPlugins(platform), options.log);
  const server = new PluginPipeServer({
    path: options.pipePath ?? pipePath(currentPipeName(), platform),
    hostVersion: options.hostVersion,
    registry,
    signedInAs: options.signedInAs,
    log: options.log,
    platform,
    ...(options.onSessionsChanged ? { onSessionsChanged: options.onSessionsChanged } : {}),
  });
  return { registry, server };
}

export type { PluginStatus } from './registry.js';
export type { AddInSession, CadFileKind, CadFileType, CadInstallation, GigaPlugin, PluginCommand, PluginLog } from './types.js';
export { PluginPipeServer, PluginRegistry };
