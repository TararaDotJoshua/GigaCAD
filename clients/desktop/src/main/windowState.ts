// The window's size, position and maximized state, kept in settings so it opens where it was.

export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowState extends Bounds {
  readonly maximized: boolean;
}

/**
 * The saved bounds, if enough of the window would still be on a connected screen to grab its
 * title bar (a screen may have been unplugged since). Sizes keep to the window's minimum.
 */
export function restorableBounds(saved: WindowState | null | undefined, screens: readonly Bounds[], minimum = { width: 860, height: 560 }): Bounds | undefined {
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return undefined;
  const bounds = { x: saved.x, y: saved.y, width: Math.max(saved.width, minimum.width), height: Math.max(saved.height, minimum.height) };
  // The top strip of the window (its title bar) must overlap a screen by at least 100 × 40 px.
  const visible = screens.some((screen) => {
    const left = Math.max(bounds.x, screen.x);
    const right = Math.min(bounds.x + bounds.width, screen.x + screen.width);
    const top = Math.max(bounds.y, screen.y);
    const bottom = Math.min(bounds.y + 52, screen.y + screen.height);
    return right - left >= 100 && bottom - top >= 40;
  });
  return visible ? bounds : undefined;
}
