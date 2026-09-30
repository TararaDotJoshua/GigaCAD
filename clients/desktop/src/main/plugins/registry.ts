import type { AddInSession, CadFileType, CadInstallation, CommandResult, GigaPlugin, PluginCommand, PluginLog } from './types.js';

export type Capability = 'fileTypes' | 'ignorePatterns' | 'installations' | 'commands' | 'addIn';

export interface PluginStatus {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** `failed` plugins were refused at start (bad or duplicate id) and take no part. */
  readonly state: 'active' | 'failed';
  readonly error?: string;
  /** Capabilities turned off after throwing. They stay off until the app restarts. */
  readonly turnedOff: readonly Capability[];
}

export interface RegisteredFileType {
  readonly pluginId: string;
  readonly fileType: CadFileType;
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * What the plugins add up to. Every call into a plugin is guarded: if a capability throws, it's
 * logged and turned off for that plugin, and the app carries on.
 */
export class PluginRegistry {
  private readonly active: GigaPlugin[] = [];
  private readonly failed: PluginStatus[] = [];
  private readonly turnedOff = new Map<string, Set<Capability>>();
  private readonly types = new Map<string, RegisteredFileType>();
  private readonly patterns: string[] = [];

  constructor(
    plugins: readonly GigaPlugin[],
    private readonly log: PluginLog,
  ) {
    const ids = new Set<string>();
    for (const plugin of plugins) {
      const error = !ID.test(plugin.id)
        ? `id "${plugin.id}" must be lowercase letters, digits, and single dashes`
        : ids.has(plugin.id)
          ? `Another plugin already uses the id ${plugin.id}`
          : undefined;
      if (error) {
        this.failed.push({ id: plugin.id, name: plugin.name, version: plugin.version, state: 'failed', error, turnedOff: [] });
        log('error', `Plugin ${plugin.id} was refused: ${error}`);
        continue;
      }
      ids.add(plugin.id);
      this.active.push(plugin);
    }
    // Sorted by id, so the first plugin to claim an extension is always the same one.
    this.active.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    for (const plugin of this.active) {
      for (const type of this.guard(plugin, 'fileTypes', () => [...(plugin.fileTypes ?? [])], [])) {
        const extension = normalizeExtension(type.extension);
        const existing = this.types.get(extension);
        if (existing) log('warn', `Plugins ${plugin.id} and ${existing.pluginId} both claim ${extension}; ${existing.pluginId} keeps it`);
        else this.types.set(extension, { pluginId: plugin.id, fileType: { ...type, extension } });
      }
      for (const pattern of this.guard(plugin, 'ignorePatterns', () => [...(plugin.ignorePatterns ?? [])], [])) {
        if (!this.patterns.some((existing) => existing.toLowerCase() === pattern.toLowerCase())) this.patterns.push(pattern);
      }
    }
  }

  /** Every plugin, including refused ones, for the plugin list in Settings. */
  get status(): readonly PluginStatus[] {
    const active = this.active.map((plugin): PluginStatus => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      state: 'active',
      turnedOff: [...(this.turnedOff.get(plugin.id) ?? [])],
    }));
    return [...active, ...this.failed];
  }

  /** Ignore patterns from every plugin, on top of packages/core's defaults. */
  get ignorePatterns(): readonly string[] {
    return this.patterns;
  }

  get fileTypes(): ReadonlyMap<string, RegisteredFileType> {
    return this.types;
  }

  fileTypeFor(path: string): RegisteredFileType | undefined {
    const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? this.types.get(name.slice(dot).toLowerCase()) : undefined;
  }

  isTurnedOff(pluginId: string, capability: Capability): boolean {
    return this.turnedOff.get(pluginId)?.has(capability) ?? false;
  }

  /** Installed CAD programs. Asks the plugins each time, since programs get installed and removed. */
  async findInstallations(): Promise<readonly (CadInstallation & { readonly pluginId: string })[]> {
    const found = await Promise.all(
      this.active.map(async (plugin) => {
        if (!plugin.findInstallations || this.isTurnedOff(plugin.id, 'installations')) return [];
        try {
          return (await plugin.findInstallations()).map((installation) => ({ ...installation, pluginId: plugin.id }));
        } catch (error) {
          this.turnOff(plugin, 'installations', error);
          return [];
        }
      }),
    );
    return found.flat();
  }

  /**
   * Commands for a selection. A command that names file kinds shows only when the selection has
   * one of the plugin's own file types of that kind; one that names none always shows.
   */
  commandsFor(paths: readonly string[]): readonly (PluginCommand & { readonly pluginId: string })[] {
    const types = paths.map((path) => this.fileTypeFor(path)).filter((type) => type !== undefined);
    return this.active.flatMap((plugin) =>
      this.guard(plugin, 'commands', () => [...(plugin.commands ?? [])], [])
        .filter(
          (command) =>
            !command.appliesTo?.length ||
            types.some((type) => type.pluginId === plugin.id && command.appliesTo!.includes(type.fileType.kind)),
        )
        .map((command) => ({ ...command, pluginId: plugin.id })),
    );
  }

  async runCommand(pluginId: string, commandId: string, paths: readonly string[]): Promise<CommandResult> {
    const plugin = this.active.find((candidate) => candidate.id === pluginId);
    if (!plugin?.runCommand) return { ok: false, message: `No plugin ${pluginId} with commands` };
    if (this.isTurnedOff(pluginId, 'commands')) return { ok: false, message: `${plugin.name} commands are off after an error. Restart GigaCAD to try again.` };
    try {
      return await plugin.runCommand(commandId, paths);
    } catch (error) {
      this.turnOff(plugin, 'commands', error);
      return { ok: false, message: `${plugin.name} failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** The plugin whose add-in sends this `clientId`. */
  addInOwner(clientId: string): GigaPlugin | undefined {
    return this.active.find((plugin) => plugin.addIn?.clientId === clientId && !this.isTurnedOff(plugin.id, 'addIn'));
  }

  notifyConnected(plugin: GigaPlugin, session: AddInSession): void {
    this.guard(plugin, 'addIn', () => plugin.addIn?.onConnected?.(session), undefined);
  }

  notifyDisconnected(plugin: GigaPlugin, session: AddInSession): void {
    this.guard(plugin, 'addIn', () => plugin.addIn?.onDisconnected?.(session), undefined);
  }

  private guard<T>(plugin: GigaPlugin, capability: Capability, call: () => T, fallback: T): T {
    if (this.isTurnedOff(plugin.id, capability)) return fallback;
    try {
      return call();
    } catch (error) {
      this.turnOff(plugin, capability, error);
      return fallback;
    }
  }

  private turnOff(plugin: GigaPlugin, capability: Capability, error: unknown): void {
    let set = this.turnedOff.get(plugin.id);
    if (!set) this.turnedOff.set(plugin.id, (set = new Set()));
    set.add(capability);
    this.log('error', `Plugin ${plugin.id} failed in ${capability}; that's off until GigaCAD restarts`, error);
  }
}

function normalizeExtension(extension: string): string {
  const trimmed = extension.trim().toLowerCase();
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}
