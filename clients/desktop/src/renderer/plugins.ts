import type { PluginState } from '../shared/types.js';

/** One line about a CAD plugin for Settings: whether its program and add-in are there and running. */
export function pluginSummary(plugin: PluginState): string {
  if (plugin.state === 'failed') return `Didn’t load: ${plugin.error ?? 'unknown error'}`;
  if (plugin.turnedOff.length > 0) return `Partly off after an error (${plugin.turnedOff.join(', ')}). Restart GigaCAD to try again.`;
  const connected = plugin.addInsConnected > 0 ? ` · Add-in connected${plugin.addInsConnected > 1 ? ` in ${plugin.addInsConnected} windows` : ''}` : '';
  if (plugin.installations.length === 0) return `Not installed on this PC${connected}`;
  const versions = plugin.installations.map((installation) => installation.version).join(', ');
  const registered = plugin.installations.some((installation) => installation.addInRegistered);
  return `${plugin.name} ${versions} · ${registered ? 'Add-in installed' : 'Add-in not installed'}${connected}`;
}

