import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AddInSession, CadFileType, CadInstallation, GigaPlugin } from './types.js';

/**
 * The SolidWorks add-in's COM class id. SolidWorks lists add-ins under
 * HKLM\SOFTWARE\SolidWorks\Addins\{guid}. The add-in's [Guid] must match; never change it.
 */
export const SOLIDWORKS_ADDIN_GUID = '418f9708-1a89-47aa-a633-86bb665d1fad';

export const SOLIDWORKS_FILE_TYPES: readonly CadFileType[] = [
  { extension: '.sldprt', displayName: 'SolidWorks Part', kind: 'part', hasReferences: false },
  { extension: '.sldasm', displayName: 'SolidWorks Assembly', kind: 'assembly', hasReferences: true },
  { extension: '.slddrw', displayName: 'SolidWorks Drawing', kind: 'drawing', hasReferences: true },
  { extension: '.sldlfp', displayName: 'SolidWorks Library Feature Part', kind: 'other', hasReferences: false },
  { extension: '.sldblk', displayName: 'SolidWorks Block', kind: 'other', hasReferences: false },
  { extension: '.slddrt', displayName: 'SolidWorks Sheet Format', kind: 'other', hasReferences: false },
  { extension: '.sldftp', displayName: 'SolidWorks Form Tool', kind: 'other', hasReferences: false },
];

/** The SolidWorks entries of DEFAULT_IGNORE_PATTERNS in packages/core/src/ignore.ts. A test keeps them equal. */
export const SOLIDWORKS_IGNORE_PATTERNS: readonly string[] = ['~$*', '*.tmp', '*.bak', 'Backup of *', 'Backup (*) of *', 'AutoRecover of *'];

const SOLIDWORKS_KEY = 'HKLM\\SOFTWARE\\SolidWorks';
const VERSION_KEY = /^SOLIDWORKS (\d{4})$/i;

/** Reads HKEY_LOCAL_MACHINE. Keys are written `HKLM\SOFTWARE\…`. */
export interface RegistryReader {
  subKeys(key: string): Promise<readonly string[]>;
  value(key: string, name: string): Promise<string | undefined>;
  exists(key: string): Promise<boolean>;
}

export interface SolidWorksPluginOptions {
  readonly platform?: NodeJS.Platform;
  readonly registry?: RegistryReader;
}

export type SolidWorksPlugin = GigaPlugin & {
  /** How many SolidWorks windows have the add-in connected right now. */
  readonly connectedAddIns: number;
};

export function createSolidWorksPlugin(options: SolidWorksPluginOptions = {}): SolidWorksPlugin {
  const platform = options.platform ?? process.platform;
  const registry = options.registry ?? regExeReader();
  const sessions = new Set<string>();

  return {
    id: 'solidworks',
    name: 'SolidWorks',
    version: '0.1.0',
    fileTypes: SOLIDWORKS_FILE_TYPES,
    ignorePatterns: SOLIDWORKS_IGNORE_PATTERNS,
    get connectedAddIns() {
      return sessions.size;
    },

    /**
     * Each version has HKLM\SOFTWARE\SolidWorks\SOLIDWORKS <year>, whose Setup subkey holds
     * "SolidWorks Folder". Versions without a folder (uninstalled, keys left behind) are skipped.
     */
    async findInstallations(): Promise<readonly CadInstallation[]> {
      if (platform !== 'win32') return [];
      const addInRegistered = await registry.exists(`${SOLIDWORKS_KEY}\\Addins\\{${SOLIDWORKS_ADDIN_GUID}}`);
      const installations: CadInstallation[] = [];
      for (const name of await registry.subKeys(SOLIDWORKS_KEY)) {
        const match = VERSION_KEY.exec(name);
        if (!match) continue;
        const folder = await registry.value(`${SOLIDWORKS_KEY}\\${name}\\Setup`, 'SolidWorks Folder');
        if (!folder?.trim()) continue;
        installations.push({ name: 'SolidWorks', version: match[1]!, installPath: folder, addInRegistered });
      }
      return installations.sort((a, b) => b.version.localeCompare(a.version));
    },

    addIn: {
      clientId: 'solidworks',
      onConnected(session: AddInSession) {
        sessions.add(session.sessionId);
      },
      onDisconnected(session: AddInSession) {
        sessions.delete(session.sessionId);
      },
    },
  };
}

type Run = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

const execFileAsync = promisify(execFile);
const defaultRun: Run = (file, args) => execFileAsync(file, [...args], { windowsHide: true });

/**
 * Registry access through reg.exe, since the app can't ship native modules. /reg:64 reads the
 * 64-bit view, where SolidWorks (64-bit only) registers. reg.exe exits 1 for a missing key.
 */
export function regExeReader(run: Run = defaultRun): RegistryReader {
  const query = async (args: readonly string[]): Promise<string | undefined> => {
    try {
      return (await run('reg.exe', ['query', ...args, '/reg:64'])).stdout;
    } catch (error) {
      if ((error as { code?: unknown }).code === 1) return undefined;
      throw error;
    }
  };
  return {
    async subKeys(key) {
      const output = await query([key]);
      return output === undefined ? [] : parseRegSubKeys(output, key);
    },
    async value(key, name) {
      const output = await query([key, '/v', name]);
      return output === undefined ? undefined : parseRegValue(output, name);
    },
    async exists(key) {
      return (await query([key])) !== undefined;
    },
  };
}

const HIVES: Record<string, string> = { HKLM: 'HKEY_LOCAL_MACHINE', HKCU: 'HKEY_CURRENT_USER', HKCR: 'HKEY_CLASSES_ROOT', HKU: 'HKEY_USERS' };

function fullKey(key: string): string {
  const [hive = '', ...rest] = key.split('\\');
  return [HIVES[hive.toUpperCase()] ?? hive, ...rest].join('\\');
}

/** The names of `key`'s direct subkeys in `reg query <key>` output. */
export function parseRegSubKeys(output: string, key: string): string[] {
  const prefix = `${fullKey(key)}\\`.toLowerCase();
  const names: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.toLowerCase().startsWith(prefix)) continue;
    const name = trimmed.slice(prefix.length);
    if (name && !name.includes('\\')) names.push(name);
  }
  return names;
}

/** A value's data in `reg query <key> /v <name>` output: `    <name>    REG_SZ    <data>`. */
export function parseRegValue(output: string, name: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(.+?)\s{4}(REG_[A-Z_]+)(?:\s{4}(.*))?$/.exec(line);
    if (match && match[1]!.toLowerCase() === name.toLowerCase()) return match[3] ?? '';
  }
  return undefined;
}
