/** Which project events change what an open page shows. */

interface LiveEvent {
  readonly kind?: string;
  readonly payload?: unknown;
}

/** Pages that show a branch's history or files, where every autosave is news. */
const BRANCH_PAGE = /\/(branches\/|tree\/Branches(\/|$))/i;

/**
 * Whether an event on the project feed should refresh the page at `pathname`. Autosaves come
 * from every member's desktop every few minutes; only branch pages show them.
 */
export function refreshesPage(event: LiveEvent, pathname: string): boolean {
  const payload = event.payload && typeof event.payload === 'object' ? (event.payload as { kind?: unknown }) : {};
  if (event.kind === 'commit_created' && payload.kind === 'autosave') return BRANCH_PAGE.test(pathname);
  return true;
}
