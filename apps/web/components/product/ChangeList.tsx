import type { ItemChange } from '@gigacad/core';
import { changeVerb } from '../../lib/describe';
import { hasModel } from '../../lib/models';
import { isSolidWorks } from '../../lib/preview';
import { getFileExports, getThumbnails } from '../../lib/product';
import { EmptyState } from './EmptyState';
import { FileActions } from './FileActions';
import { FileGlyph } from './FileGlyph';
import { StatusBadge } from './StatusBadge';

/** How the numbers read in a summary line: "3 files changed: 2 edited, 1 added". */
export function changeSummary(changes: readonly ItemChange[]): string {
  const count = (kind: ItemChange['kind']) => changes.filter((change) => change.kind === kind).length;
  const parts = [
    [count('modified'), 'edited'],
    [count('added'), 'added'],
    [count('deleted'), 'removed'],
  ].flatMap(([n, word]) => (n ? [`${n} ${word}`] : []));
  return `${changes.length} ${changes.length === 1 ? 'file' : 'files'} changed${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

/**
 * Files that differ between two snapshots, each with what happened and, when it still
 * exists, its thumbnail, a preview, and downloads of the new contents and their exports.
 */
export async function ChangeList({
  projectId,
  changes,
  empty = 'No file changes.',
  releaseNumber,
}: {
  projectId: string;
  changes: readonly ItemChange[];
  empty?: string;
  /** For a release's changes: show the exports and thumbnails it was made with. */
  releaseNumber?: number;
}) {
  if (changes.length === 0) return <EmptyState title={empty} />;
  const sorted = [...changes].sort((a, b) => pathOf(a).localeCompare(pathOf(b)));
  const current = sorted.flatMap((change) => (change.kind === 'deleted' ? [] : [change.after]));
  const [thumbnails, exports] = await Promise.all([
    getThumbnails(projectId, current.filter((file) => hasModel(file.path)).map((file) => file.blob), releaseNumber),
    getFileExports(projectId, current.filter((file) => isSolidWorks(file.path)).map((file) => file.blob), releaseNumber),
  ]);
  return (
    <ul className="change-list">
      {sorted.map((change) => {
        const path = pathOf(change);
        const after = change.kind === 'deleted' ? null : change.after;
        return (
          <li key={change.itemId} className={`change-row is-${change.kind}`}>
            <FileGlyph path={path} thumbnailUrl={after ? thumbnails[after.blob] : undefined} />
            <span className="change-path">
              <span className="mono">{path}</span>
              <span className="change-verb">
                <StatusBadge tone={change.kind === 'added' ? 'signal' : change.kind === 'deleted' ? 'danger' : 'quiet'}>{change.kind === 'added' ? 'Added' : change.kind === 'deleted' ? 'Removed' : 'Edited'}</StatusBadge>
                {change.kind === 'modified' && change.moved && <span className="muted"> {changeVerb(change)}</span>}
              </span>
            </span>
            {after && (
              <span className="cell-action">
                <FileActions projectId={projectId} path={after.path} blob={after.blob} exports={exports[after.blob] ?? []} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const pathOf = (change: ItemChange) => (change.kind === 'deleted' ? change.before.path : change.after.path);
