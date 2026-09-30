import { describe, expect, it } from 'vitest';
import { pluginSummary } from '../src/renderer/plugins.js';
import { platformWords } from '../src/shared/platform.js';
import type { PluginState } from '../src/shared/types.js';

describe('platformWords', () => {
  it('names things the way each system does', () => {
    expect(platformWords('darwin')).toMatchObject({ thisComputer: 'this Mac', showInFileManager: 'Show in Finder' });
    expect(platformWords('win32')).toMatchObject({ thisComputer: 'this PC', showInFileManager: 'Show in File Explorer', fileManager: 'File Explorer' });
  });
});

describe('pluginSummary', () => {
  const solidworks: PluginState = { id: 'solidworks', name: 'SolidWorks', version: '0.1.0', state: 'active', error: null, turnedOff: [], installations: [], addInsConnected: 0 };

  it('says when the program is missing', () => {
    expect(pluginSummary(solidworks)).toBe('Not installed on this PC');
  });

  it('lists versions and whether the add-in is installed and connected', () => {
    const installed = { ...solidworks, installations: [{ version: '2025', installPath: 'C:\\SW', addInRegistered: false }, { version: '2024', installPath: 'C:\\SW24', addInRegistered: false }] };
    expect(pluginSummary(installed)).toBe('SolidWorks 2025, 2024 · Add-in not installed');
    const running = { ...installed, installations: [{ version: '2025', installPath: 'C:\\SW', addInRegistered: true }], addInsConnected: 2 };
    expect(pluginSummary(running)).toBe('SolidWorks 2025 · Add-in installed · Add-in connected in 2 windows');
  });

  it('explains failures', () => {
    expect(pluginSummary({ ...solidworks, state: 'failed', error: 'bad id' })).toBe('Didn’t load: bad id');
    expect(pluginSummary({ ...solidworks, turnedOff: ['installations'] })).toContain('Restart GigaCAD');
  });
});
