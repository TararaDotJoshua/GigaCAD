/**
 * The shell is what a DMG installs: the Electron runtime and this bootstrap. Code bundles
 * say which shell they need (`shellMin`), and a bundle that needs a newer shell is never
 * downloaded; the app asks for a fresh DMG instead.
 *
 * Bump this by hand whenever the Electron version or anything in src/bootstrap changes.
 * CI fails if either changes without a bump (scripts/check-shell.mjs).
 */
export const SHELL_VERSION = 2;
