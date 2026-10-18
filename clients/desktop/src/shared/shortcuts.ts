// Keyboard shortcuts (desktop UX plan, decision 5). The window handles the keys on both systems;
// on macOS the View and Go menus list them too, and choosing one sends its action to the window.
// Mod is ⌘ on macOS and Ctrl on Windows.

export type ShortcutAction =
  | 'commit'
  | 'settings'
  | 'refresh'
  | 'filter'
  | 'back'
  | 'forward'
  | 'openWeb'
  | 'reveal'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | `project${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

export interface Shortcut {
  readonly action: ShortcutAction;
  readonly label: string;
  /** Electron accelerator, with CmdOrCtrl for Mod. */
  readonly accelerator: string;
  readonly menu: 'view' | 'go' | null;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { action: 'commit', label: 'Commit Version', accelerator: 'CmdOrCtrl+Enter', menu: null },
  { action: 'settings', label: 'Settings', accelerator: 'CmdOrCtrl+,', menu: null },
  { action: 'refresh', label: 'Refresh', accelerator: 'CmdOrCtrl+R', menu: 'view' },
  { action: 'filter', label: 'Filter Projects', accelerator: 'CmdOrCtrl+F', menu: 'view' },
  { action: 'zoomIn', label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', menu: 'view' },
  { action: 'zoomOut', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', menu: 'view' },
  { action: 'zoomReset', label: 'Actual Size', accelerator: 'CmdOrCtrl+0', menu: 'view' },
  { action: 'back', label: 'Back', accelerator: 'CmdOrCtrl+[', menu: 'go' },
  { action: 'forward', label: 'Forward', accelerator: 'CmdOrCtrl+]', menu: 'go' },
  { action: 'openWeb', label: 'Open on gigacad.site', accelerator: 'CmdOrCtrl+Shift+O', menu: 'go' },
  { action: 'reveal', label: 'Show in Finder', accelerator: 'CmdOrCtrl+Shift+R', menu: 'go' },
  ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n) => ({ action: `project${n}` as const, label: `Project ${n}`, accelerator: `CmdOrCtrl+${n}`, menu: 'go' as const })),
];

/** The action for a key press in the window, if it's a shortcut. */
export function shortcutFor(event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, platform: string): ShortcutAction | null {
  if (event.altKey) return null;
  if (platform === 'win32' && event.key === 'F5' && !event.ctrlKey && !event.shiftKey) return 'refresh';
  const mod = platform === 'win32' ? event.ctrlKey && !event.metaKey : event.metaKey && !event.ctrlKey;
  if (!mod) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.shiftKey) {
    if (key === 'o') return 'openWeb';
    if (key === 'r') return 'reveal';
    // Plus is Shift+= on most keyboards.
    if (key === '+' || key === '=') return 'zoomIn';
    return null;
  }
  if (key === 'Enter') return 'commit';
  if (key === ',') return 'settings';
  if (key === 'r') return 'refresh';
  if (key === 'f') return 'filter';
  if (key === '[') return 'back';
  if (key === ']') return 'forward';
  if (key === '=' || key === '+') return 'zoomIn';
  if (key === '-') return 'zoomOut';
  if (key === '0') return 'zoomReset';
  if (/^[1-9]$/.test(key)) return `project${Number(key) as 1}`;
  return null;
}

/** "⌘⇧O" on macOS, "Ctrl+Shift+O" on Windows, for tooltips. */
export function shortcutLabel(action: ShortcutAction, platform: string): string {
  const shortcut = SHORTCUTS.find((candidate) => candidate.action === action);
  if (!shortcut) return '';
  const parts = shortcut.accelerator.split('+').slice(1);
  if (platform === 'win32') return ['Ctrl', ...parts].join('+');
  return `⌘${parts.map((part) => (part === 'Shift' ? '⇧' : part === 'Enter' ? '↩' : part === 'Plus' ? '+' : part)).join('')}`;
}
