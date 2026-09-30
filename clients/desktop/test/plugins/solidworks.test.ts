import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPluginHost } from '../../src/main/plugins/index.js';
import {
  createSolidWorksPlugin,
  parseRegSubKeys,
  parseRegValue,
  regExeReader,
  SOLIDWORKS_ADDIN_GUID,
  type RegistryReader,
} from '../../src/main/plugins/solidworks.js';

const KEY = 'HKLM\\SOFTWARE\\SolidWorks';

function fakeRegistry(keys: Record<string, Record<string, string>>): RegistryReader {
  const lower = new Map(Object.entries(keys).map(([key, values]) => [key.toLowerCase(), values]));
  return {
    async subKeys(key) {
      const prefix = `${key}\\`.toLowerCase();
      return Object.keys(keys)
        .filter((candidate) => candidate.toLowerCase().startsWith(prefix) && !candidate.slice(prefix.length).includes('\\'))
        .map((candidate) => candidate.slice(prefix.length));
    },
    async value(key, name) {
      return lower.get(key.toLowerCase())?.[name];
    },
    async exists(key) {
      return lower.has(key.toLowerCase());
    },
  };
}

describe('SolidWorks plugin', () => {
  it('knows SolidWorks file types', () => {
    const plugin = createSolidWorksPlugin({ platform: 'darwin' });
    const types = new Map(plugin.fileTypes!.map((type) => [type.extension, type]));
    expect(types.get('.sldprt')).toMatchObject({ kind: 'part', hasReferences: false });
    expect(types.get('.sldasm')).toMatchObject({ kind: 'assembly', hasReferences: true });
    expect(types.get('.slddrw')).toMatchObject({ kind: 'drawing', hasReferences: true });
    expect(types.size).toBe(7);
  });

  it('ignores the same SolidWorks files as packages/core', () => {
    const source = readFileSync(new URL('../../../../packages/core/src/ignore.ts', import.meta.url), 'utf8');
    const list = /DEFAULT_IGNORE_PATTERNS[^=]*=\s*\[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
    const section = /\/\/ SolidWorks[^\n]*\n([\s\S]*?)(?=\n\s*\/\/)/.exec(list)?.[1] ?? '';
    const core = [...section.matchAll(/'([^']*)'/g)].map((match) => match[1]);
    expect(core.length).toBeGreaterThan(0);
    expect(createSolidWorksPlugin().ignorePatterns).toEqual(core);
  });

  it('finds installed versions newest first', async () => {
    const plugin = createSolidWorksPlugin({
      platform: 'win32',
      registry: fakeRegistry({
        [KEY]: {},
        [`${KEY}\\SOLIDWORKS 2023`]: {},
        [`${KEY}\\SOLIDWORKS 2023\\Setup`]: { 'SolidWorks Folder': 'C:\\Program Files\\SOLIDWORKS Corp 2023\\SOLIDWORKS\\' },
        [`${KEY}\\SolidWorks 2025`]: {},
        [`${KEY}\\SolidWorks 2025\\Setup`]: { 'SolidWorks Folder': 'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\' },
        // Uninstalled, but its key was left behind.
        [`${KEY}\\SOLIDWORKS 2024`]: {},
        [`${KEY}\\Applications`]: {},
        [`${KEY}\\Addins`]: {},
        [`${KEY}\\Addins\\{${SOLIDWORKS_ADDIN_GUID}}`]: {},
      }),
    });

    expect(await plugin.findInstallations!()).toEqual([
      { name: 'SolidWorks', version: '2025', installPath: 'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\', addInRegistered: true },
      { name: 'SolidWorks', version: '2023', installPath: 'C:\\Program Files\\SOLIDWORKS Corp 2023\\SOLIDWORKS\\', addInRegistered: true },
    ]);
  });

  it('finds nothing without SolidWorks or off Windows', async () => {
    expect(await createSolidWorksPlugin({ platform: 'win32', registry: fakeRegistry({}) }).findInstallations!()).toEqual([]);
    const untouched: RegistryReader = {
      subKeys: () => Promise.reject(new Error('should not be called')),
      value: () => Promise.reject(new Error('should not be called')),
      exists: () => Promise.reject(new Error('should not be called')),
    };
    expect(await createSolidWorksPlugin({ platform: 'darwin', registry: untouched }).findInstallations!()).toEqual([]);
  });

  it('counts connected SolidWorks windows', () => {
    const plugin = createSolidWorksPlugin({ platform: 'darwin' });
    const session = (sessionId: string) => ({ sessionId, clientId: 'solidworks', clientVersion: '0.1.0', cadName: 'SolidWorks', cadVersion: '2025', processId: 1 });
    plugin.addIn!.onConnected!(session('a'));
    plugin.addIn!.onConnected!(session('b'));
    plugin.addIn!.onDisconnected!(session('a'));
    expect(plugin.connectedAddIns).toBe(1);
    expect(plugin.addIn!.clientId).toBe('solidworks');
  });

  it('is built in to the plugin host', () => {
    const { registry } = createPluginHost({ hostVersion: '1', signedInAs: () => null, log: () => undefined, platform: 'darwin', pipePath: '/tmp/unused' });
    expect(registry.status.map((status) => status.id)).toEqual(['solidworks']);
    expect(registry.fileTypeFor('C:\\x\\Robot.SLDASM')?.pluginId).toBe('solidworks');
    expect(registry.addInOwner('solidworks')?.id).toBe('solidworks');
  });
});

describe('reg.exe output', () => {
  const list = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\SolidWorks',
    '    Version    REG_SZ    2025',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\SolidWorks\\Addins',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\SolidWorks\\SOLIDWORKS 2024',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\SolidWorks\\SOLIDWORKS 2025',
    '',
  ].join('\r\n');

  it('lists direct subkeys', () => {
    expect(parseRegSubKeys(list, KEY)).toEqual(['Addins', 'SOLIDWORKS 2024', 'SOLIDWORKS 2025']);
  });

  it('reads a value whose name has spaces', () => {
    const output = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\SolidWorks\\SOLIDWORKS 2025\\Setup\r\n    SolidWorks Folder    REG_SZ    C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\\r\n\r\n';
    expect(parseRegValue(output, 'SolidWorks Folder')).toBe('C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\');
    expect(parseRegValue(output, 'Other')).toBeUndefined();
  });

  it('runs reg.exe in the 64-bit view and treats exit code 1 as missing', async () => {
    const calls: string[][] = [];
    const reader = regExeReader(async (_file, args) => {
      calls.push([...args]);
      if (args[1]?.endsWith('Missing')) throw Object.assign(new Error('not found'), { code: 1 });
      return { stdout: list };
    });

    expect(await reader.subKeys(KEY)).toContain('SOLIDWORKS 2025');
    expect(await reader.exists(`${KEY}\\Missing`)).toBe(false);
    expect(await reader.value(`${KEY}\\Missing`, 'x')).toBeUndefined();
    expect(calls[0]).toEqual(['query', KEY, '/reg:64']);
    expect(calls[2]).toEqual(['query', `${KEY}\\Missing`, '/v', 'x', '/reg:64']);
  });

  it('passes other reg.exe failures on', async () => {
    const reader = regExeReader(async () => {
      throw Object.assign(new Error('spawn reg.exe ENOENT'), { code: 'ENOENT' });
    });
    await expect(reader.subKeys(KEY)).rejects.toThrow('ENOENT');
  });
});
