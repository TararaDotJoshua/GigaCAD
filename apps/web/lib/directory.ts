/** Wording and paging for the project file directory, kept apart from the components so they can be tested. */

/** What deleting a root file or folder takes with it. */
export interface EntryContents {
  readonly files: number;
  readonly folders: number;
  readonly revisions: number;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The scale of a delete, for its confirmation: "Deletes 40 files in 3 folders, with 52 revisions." */
export function deleteSummary(kind: 'file' | 'folder', contents: EntryContents): string {
  if (kind === 'file') return contents.revisions > 1 ? `Deletes this file and all ${contents.revisions} of its revisions.` : 'Deletes this file.';
  if (contents.files === 0 && contents.folders === 0) return 'This folder is empty.';
  const where = contents.folders > 0 ? ` in ${count(contents.folders, 'folder')}` : '';
  if (contents.files === 0) return `Deletes ${count(contents.folders, 'empty folder')}.`;
  const revisions = contents.revisions > contents.files ? `, with ${count(contents.revisions, 'revision')}` : '';
  return `Deletes ${count(contents.files, 'file')}${where}${revisions}.`;
}

export interface PagerState {
  /** "101–200 of 640", or null when there's nothing on this page to count. */
  readonly label: string | null;
  readonly previous: number | null;
  readonly next: number | null;
  /** Past the last page: the offset of the last page, to send people back to. */
  readonly last: number | null;
}

/**
 * The pager for a page of `shown` entries starting at `offset`, out of `total`. Built-in folders
 * shown above the first page don't count. Previous never steps past the end: from far beyond the
 * last page it goes to the last page.
 */
export function pager({ offset, shown, total, pageSize, nextOffset }: { offset: number; shown: number; total: number; pageSize: number; nextOffset: number | null }): PagerState {
  const lastOffset = total > 0 ? Math.floor((total - 1) / pageSize) * pageSize : 0;
  const previous = offset > 0 ? (offset > lastOffset ? lastOffset : Math.max(0, offset - pageSize)) : null;
  if (shown === 0) return { label: null, previous, next: null, last: total > 0 && offset > lastOffset ? lastOffset : null };
  return {
    label: `${offset + 1}–${offset + shown} of ${total}`,
    previous,
    next: nextOffset,
    last: null,
  };
}

type UploadState = 'waiting' | 'hashing' | 'uploading' | 'saving' | 'done' | 'failed' | 'skipped' | 'taken';

/**
 * The upload toast's title. Skipped files and ones waiting on the "already here" question
 * don't count toward the total, and it reads "Uploaded" as soon as every file is through.
 */
export function uploadTitle(phases: readonly UploadState[]): string {
  const counted = phases.filter((phase) => phase !== 'skipped' && phase !== 'taken');
  const done = counted.filter((phase) => phase === 'done').length;
  const failed = counted.filter((phase) => phase === 'failed').length;
  if (done + failed < counted.length) return `Uploading ${done + failed + 1} of ${counted.length}…`;
  if (failed) return `Uploaded ${done} of ${done + failed}.`;
  if (done) return `Uploaded ${done} ${done === 1 ? 'file' : 'files'}.`;
  return phases.length ? 'Nothing was uploaded.' : '';
}

const extension = (name: string) => (name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

/** Whether replacing `current` with `picked` changes the kind of file, like README.md with notes.bin. */
export const differentExtension = (current: string, picked: string) => extension(current) !== extension(picked);
