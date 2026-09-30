import { describe, expect, it, vi } from 'vitest';
import { PluginRegistry } from '../../src/main/plugins/registry.js';
import type { GigaPlugin, PluginLog } from '../../src/main/plugins/types.js';

const quiet: PluginLog = () => undefined;

function plugin(id: string, extra: Partial<GigaPlugin> = {}): GigaPlugin {
  return { id, name: id.toUpperCase(), version: '1.0.0', ...extra };
}

describe('PluginRegistry', () => {
  it('combines file types and ignore patterns', () => {
    const registry = new PluginRegistry(
      [
        plugin('cad', { fileTypes: [{ extension: 'PRT', displayName: 'Part', kind: 'part', hasReferences: false }], ignorePatterns: ['~$*', '*.bak'] }),
        plugin('other', { fileTypes: [{ extension: '.asm', displayName: 'Assembly', kind: 'assembly', hasReferences: true }], ignorePatterns: ['*.BAK', '*.lck'] }),
      ],
      quiet,
    );

    expect(registry.fileTypeFor('C:\\GigaCAD\\alex\\arm\\Arm.PRT')).toMatchObject({ pluginId: 'cad', fileType: { extension: '.prt' } });
    expect(registry.fileTypeFor('/Users/alex/GigaCAD/robot.ASM')?.fileType.kind).toBe('assembly');
    expect(registry.fileTypeFor('notes.txt')).toBeUndefined();
    expect(registry.fileTypeFor('folder.prt/README')).toBeUndefined();
    expect(registry.fileTypeFor('.prt')).toBeUndefined();
    expect(registry.ignorePatterns).toEqual(['~$*', '*.bak', '*.lck']);
  });

  it('gives a contested extension to the first plugin by id', () => {
    const log = vi.fn<PluginLog>();
    const type = { extension: '.prt', displayName: 'Part', kind: 'part', hasReferences: false } as const;
    const registry = new PluginRegistry([plugin('zeta', { fileTypes: [type] }), plugin('alpha', { fileTypes: [type] })], log);

    expect(registry.fileTypeFor('x.prt')?.pluginId).toBe('alpha');
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('both claim .prt'));
  });

  it('refuses bad and duplicate ids and leaves them out', () => {
    const registry = new PluginRegistry([plugin('Solid_Works'), plugin('cad'), plugin('cad', { ignorePatterns: ['*.x'] })], quiet);

    expect(registry.status.map(({ id, state }) => [id, state])).toEqual([
      ['cad', 'active'],
      ['Solid_Works', 'failed'],
      ['cad', 'failed'],
    ]);
    expect(registry.status[2]?.error).toContain('already uses the id cad');
    expect(registry.ignorePatterns).toEqual([]);
  });

  it('turns off a capability that throws and keeps the rest', () => {
    const broken = plugin('broken', { ignorePatterns: ['*.tmp'] });
    Object.defineProperty(broken, 'fileTypes', {
      get() {
        throw new Error('broken');
      },
    });
    const registry = new PluginRegistry([broken, plugin('fine', { fileTypes: [{ extension: '.ok', displayName: 'OK', kind: 'part', hasReferences: false }] })], quiet);

    expect(registry.isTurnedOff('broken', 'fileTypes')).toBe(true);
    expect(registry.isTurnedOff('broken', 'ignorePatterns')).toBe(false);
    expect(registry.status.find((status) => status.id === 'broken')?.turnedOff).toEqual(['fileTypes']);
    expect(registry.ignorePatterns).toEqual(['*.tmp']);
    expect(registry.fileTypeFor('a.ok')).toBeDefined();
  });

  it('asks for installations each time and survives a locator that throws', async () => {
    let calls = 0;
    const registry = new PluginRegistry(
      [
        plugin('cad', { findInstallations: async () => [{ name: 'Cad', version: String(++calls), installPath: '/opt/cad', addInRegistered: false }] }),
        plugin('broken', {
          findInstallations: async () => {
            throw new Error('access denied');
          },
        }),
      ],
      quiet,
    );

    expect(await registry.findInstallations()).toEqual([{ name: 'Cad', version: '1', installPath: '/opt/cad', addInRegistered: false, pluginId: 'cad' }]);
    expect((await registry.findInstallations())[0]?.version).toBe('2');
    expect(registry.isTurnedOff('broken', 'installations')).toBe(true);
  });

  it("shows commands for the plugin's own file kinds", () => {
    const registry = new PluginRegistry(
      [
        plugin('cad', {
          fileTypes: [{ extension: '.prt', displayName: 'Part', kind: 'part', hasReferences: false }],
          commands: [
            { id: 'open', label: 'Open in Cad', appliesTo: ['part'] },
            { id: 'about', label: 'About Cad' },
          ],
        }),
        plugin('other', { fileTypes: [{ extension: '.oprt', displayName: 'Other part', kind: 'part', hasReferences: false }] }),
      ],
      quiet,
    );

    expect(registry.commandsFor(['a.prt', 'b.txt']).map((command) => command.id)).toEqual(['open', 'about']);
    expect(registry.commandsFor(['c.oprt']).map((command) => command.id)).toEqual(['about']);
  });

  it('runs commands and turns off ones that throw', async () => {
    const registry = new PluginRegistry(
      [
        plugin('cad', { runCommand: async (id, paths) => ({ ok: true, message: `${id} ${paths.length}` }) }),
        plugin('broken', {
          runCommand: async () => {
            throw new Error('disk');
          },
        }),
      ],
      quiet,
    );

    expect(await registry.runCommand('cad', 'open', ['a', 'b'])).toEqual({ ok: true, message: 'open 2' });
    expect(await registry.runCommand('broken', 'open', ['a'])).toEqual({ ok: false, message: 'BROKEN failed: disk' });
    expect((await registry.runCommand('broken', 'open', ['a'])).message).toContain('Restart GigaCAD');
    expect((await registry.runCommand('nobody', 'open', [])).ok).toBe(false);
  });

  it("finds the add-in's owner and guards its hooks", () => {
    const onConnected = vi.fn(() => {
      throw new Error('boom');
    });
    const cad = plugin('cad', { addIn: { clientId: 'cad-addin', onConnected } });
    const registry = new PluginRegistry([cad, plugin('other')], quiet);
    const session = { sessionId: 's', clientId: 'cad-addin', clientVersion: '1', cadName: 'Cad', cadVersion: '1', processId: 1 };

    expect(registry.addInOwner('cad-addin')).toBe(cad);
    expect(registry.addInOwner('nobody')).toBeUndefined();
    registry.notifyConnected(cad, session);
    expect(registry.isTurnedOff('cad', 'addIn')).toBe(true);
    expect(registry.addInOwner('cad-addin')).toBeUndefined();
  });
});
