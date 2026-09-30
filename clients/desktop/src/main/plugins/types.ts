/**
 * CAD plugins. A plugin adds what the app needs to know about one CAD program; everything is
 * optional except its identity. Plugins are compiled into the signed code bundle (see
 * plugins/index.ts), never loaded from disk.
 */

export type CadFileKind = 'part' | 'assembly' | 'drawing' | 'other';

export interface CadFileType {
  /** With the leading dot, any case: `.SLDPRT` and `.sldprt` are the same. */
  readonly extension: string;
  readonly displayName: string;
  readonly kind: CadFileKind;
  /** Whether files of this type point at other files (assemblies, drawings). */
  readonly hasReferences: boolean;
}

export interface CadInstallation {
  readonly name: string;
  readonly version: string;
  readonly installPath: string;
  /** Whether GigaCAD's add-in is registered with this installation. */
  readonly addInRegistered: boolean;
}

export interface PluginCommand {
  readonly id: string;
  readonly label: string;
  /** Kinds of this plugin's own file types the command shows for. Left out: every selection. */
  readonly appliesTo?: readonly CadFileKind[];
}

export interface CommandResult {
  readonly ok: boolean;
  readonly message?: string;
}

/** An add-in connected to the app from inside a CAD program. */
export interface AddInSession {
  readonly sessionId: string;
  readonly clientId: string;
  readonly clientVersion: string;
  readonly cadName: string;
  readonly cadVersion: string;
  readonly processId: number;
}

export interface PluginLog {
  (level: 'info' | 'warn' | 'error', message: string, error?: unknown): void;
}

export interface GigaPlugin {
  /** Lowercase letters, digits, and single dashes. */
  readonly id: string;
  readonly name: string;
  readonly version: string;

  readonly fileTypes?: readonly CadFileType[];
  /** Temp, lock, and backup files the CAD program writes. Gitignore syntax, case-insensitive. */
  readonly ignorePatterns?: readonly string[];
  /** Installed copies of the CAD program, for the plugin list in Settings. */
  findInstallations?(): Promise<readonly CadInstallation[]>;

  readonly commands?: readonly PluginCommand[];
  runCommand?(commandId: string, paths: readonly string[]): Promise<CommandResult>;

  /** The plugin's add-in inside the CAD program. */
  readonly addIn?: {
    /** The `clientId` the add-in sends in `host.hello`. */
    readonly clientId: string;
    onConnected?(session: AddInSession): void;
    onDisconnected?(session: AddInSession): void;
  };
}
