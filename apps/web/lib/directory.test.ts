import { describe, expect, it } from 'vitest';
import { deleteSummary, differentExtension, pager, uploadTitle } from './directory';

describe('deleteSummary', () => {
  it('says what a delete takes with it', () => {
    expect(deleteSummary('file', { files: 1, folders: 0, revisions: 1 })).toBe('Deletes this file.');
    expect(deleteSummary('file', { files: 1, folders: 0, revisions: 3 })).toBe('Deletes this file and all 3 of its revisions.');
    expect(deleteSummary('folder', { files: 40, folders: 3, revisions: 52 })).toBe('Deletes 40 files in 3 folders, with 52 revisions.');
    expect(deleteSummary('folder', { files: 1, folders: 0, revisions: 1 })).toBe('Deletes 1 file.');
    expect(deleteSummary('folder', { files: 0, folders: 2, revisions: 0 })).toBe('Deletes 2 empty folders.');
    expect(deleteSummary('folder', { files: 0, folders: 0, revisions: 0 })).toBe('This folder is empty.');
  });
});

describe('pager', () => {
  const page = (offset: number, shown: number, total: number) => pager({ offset, shown, total, pageSize: 100, nextOffset: offset + shown < total ? offset + shown : null });

  it('counts the files on the page, not the built-in folders above it', () => {
    expect(page(0, 100, 600)).toEqual({ label: '1–100 of 600', previous: null, next: 100, last: null });
    expect(page(500, 100, 600)).toEqual({ label: '501–600 of 600', previous: 400, next: null, last: null });
  });

  it('sends a page past the end to the last page, and steps back from far beyond it to the last page', () => {
    expect(page(130, 0, 130)).toMatchObject({ label: null, last: 100, previous: 100 });
    expect(page(900, 0, 130)).toMatchObject({ last: 100, previous: 100 });
    expect(page(200, 0, 0)).toMatchObject({ last: null });
    // An empty page that isn't past the end (every row hidden) doesn't redirect to itself.
    expect(page(100, 0, 150).last).toBeNull();
  });
});

describe('uploadTitle', () => {
  it('counts only files being uploaded, and says Uploaded as soon as they are all through', () => {
    expect(uploadTitle(['uploading', 'waiting', 'skipped'])).toBe('Uploading 1 of 2…');
    expect(uploadTitle(['done', 'skipped'])).toBe('Uploaded 1 file.');
    expect(uploadTitle(['done', 'failed', 'taken'])).toBe('Uploaded 1 of 2.');
    expect(uploadTitle(['skipped'])).toBe('Nothing was uploaded.');
    expect(uploadTitle([])).toBe('');
  });
});

describe('differentExtension', () => {
  it('tells a change of file type from a change of name', () => {
    expect(differentExtension('README.md', 'whatever-name.bin')).toBe(true);
    expect(differentExtension('Bracket.SLDPRT', 'bracket_v2.sldprt')).toBe(false);
    expect(differentExtension('Makefile', 'notes.txt')).toBe(true);
  });
});
