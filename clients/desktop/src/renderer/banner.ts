import type { UpdateState } from '../shared/types.js';

/** What the sidebar's update banner shows. Pure, so every state is covered by tests. */
export type Banner =
  | { readonly kind: 'rollback'; readonly version: string }
  | { readonly kind: 'downloading'; readonly percent: number }
  | { readonly kind: 'ready'; readonly version: string; readonly notes: string; readonly notesUrl: string | null; readonly restarting: boolean }
  | { readonly kind: 'reinstall'; readonly version: string; readonly notes: string; readonly dmgUrl: string };

/**
 * The rollback notice comes first. Checking, idle, and errors show nothing (errors are in
 * Settings → Updates). An update closed with × stays hidden until a newer one arrives.
 */
export function bannerFor(updates: UpdateState, dismissedUpdate: string | null, rolledBackFrom: string | null): Banner | null {
  if (rolledBackFrom) return { kind: 'rollback', version: rolledBackFrom };
  switch (updates.kind) {
    case 'downloading':
      return { kind: 'downloading', percent: Math.round(Math.min(1, Math.max(0, updates.progress)) * 100) };
    case 'ready':
      if (updates.version === dismissedUpdate) return null;
      return { kind: 'ready', version: updates.version, notes: updates.notes, notesUrl: updates.notesUrl, restarting: updates.restarting };
    case 'needsReinstall':
      if (updates.version === dismissedUpdate) return null;
      return { kind: 'reinstall', version: updates.version, notes: updates.notes, dmgUrl: updates.dmgUrl };
    default:
      return null;
  }
}
