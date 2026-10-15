import { describe, expect, it } from 'vitest';
import { restorableBounds } from '../src/main/windowState.js';
import { shortcutFor, shortcutLabel } from '../src/shared/shortcuts.js';

const screen = { x: 0, y: 0, width: 1440, height: 900 };
const key = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('restorableBounds', () => {
  it('restores a window that is still on a screen', () => {
    expect(restorableBounds({ x: 100, y: 80, width: 1200, height: 800, maximized: false }, [screen])).toEqual({ x: 100, y: 80, width: 1200, height: 800 });
  });

  it('forgets a window left on a screen that was unplugged', () => {
    expect(restorableBounds({ x: 2000, y: 80, width: 1200, height: 800, maximized: false }, [screen])).toBeUndefined();
  });

  it('keeps to the minimum size, and ignores nothing saved', () => {
    expect(restorableBounds({ x: 10, y: 10, width: 300, height: 200, maximized: false }, [screen])).toEqual({ x: 10, y: 10, width: 860, height: 560 });
    expect(restorableBounds(null, [screen])).toBeUndefined();
  });
});

describe('shortcutFor', () => {
  it('uses ⌘ on macOS and Ctrl on Windows', () => {
    expect(shortcutFor(key(',', { metaKey: true }), 'darwin')).toBe('settings');
    expect(shortcutFor(key(',', { ctrlKey: true }), 'darwin')).toBeNull();
    expect(shortcutFor(key(',', { ctrlKey: true }), 'win32')).toBe('settings');
  });

  it('knows the shifted and numbered ones, and F5 on Windows', () => {
    expect(shortcutFor(key('O', { metaKey: true, shiftKey: true }), 'darwin')).toBe('openWeb');
    expect(shortcutFor(key('3', { ctrlKey: true }), 'win32')).toBe('project3');
    expect(shortcutFor(key('F5'), 'win32')).toBe('refresh');
    expect(shortcutFor(key('F5'), 'darwin')).toBeNull();
    expect(shortcutFor(key('+', { metaKey: true, shiftKey: true }), 'darwin')).toBe('zoomIn');
  });

  it('labels them for each system', () => {
    expect(shortcutLabel('openWeb', 'darwin')).toBe('⌘⇧O');
    expect(shortcutLabel('openWeb', 'win32')).toBe('Ctrl+Shift+O');
    expect(shortcutLabel('commit', 'darwin')).toBe('⌘↩');
  });
});
