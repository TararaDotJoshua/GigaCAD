import { describe, expect, it } from 'vitest';
import { refreshesPage } from './live';

describe('refreshesPage', () => {
  const autosave = { kind: 'commit_created', payload: { kind: 'autosave' } };

  it('refreshes branch pages for autosaves, and no others', () => {
    expect(refreshesPage(autosave, '/alex/robot/branches/longer-arms')).toBe(true);
    expect(refreshesPage(autosave, '/alex/robot/tree/Branches/longer-arms/parts')).toBe(true);
    expect(refreshesPage(autosave, '/alex/robot')).toBe(false);
    expect(refreshesPage(autosave, '/alex/robot/release-requests/3')).toBe(false);
  });

  it('refreshes every page for everything else', () => {
    expect(refreshesPage({ kind: 'commit_created', payload: { kind: 'version' } }, '/alex/robot')).toBe(true);
    expect(refreshesPage({ kind: 'directory_entry_created', payload: null }, '/alex/robot/tree/Docs')).toBe(true);
  });
});
