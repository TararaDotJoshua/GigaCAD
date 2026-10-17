const PENDING: Readonly<Record<string, string>> = {
  add: 'Adding…',
  approve: 'Approving…',
  archive: 'Archiving…',
  build: 'Building…',
  close: 'Closing…',
  create: 'Creating…',
  delete: 'Deleting…',
  'force-release': 'Releasing…',
  fork: 'Forking…',
  open: 'Opening…',
  rebuild: 'Rebuilding…',
  release: 'Releasing…',
  remove: 'Removing…',
  rename: 'Renaming…',
  restore: 'Restoring…',
  save: 'Saving…',
  sign: 'Signing out…',
  withdraw: 'Withdrawing…',
};

/** A button's label while its action runs, from the label's verb: "Create branch" becomes "Creating…". */
export function pendingText(label: unknown): string {
  const verb = typeof label === 'string' ? label.trim().split(/\s+/)[0]!.toLowerCase() : '';
  return PENDING[verb] ?? 'Working…';
}
