import type { ItemChange } from '@gigacad/core';
import { changeVerb } from '../../lib/describe';
import { previewFormat } from '../../lib/preview';
import { DownloadButton } from './DownloadButton';
import { EmptyState } from './EmptyState';
import { FileGlyph } from './FileGlyph';
import { PreviewButton } from './PreviewButton';
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
 * exists, a preview and a download of the new contents.
 */
export function ChangeList({ projectId, changes, empty = 'No file changes.' }: { projectId: string; changes: readonly ItemChange[]; empty?: string }) {
  if (changes.length === 0) return <EmptyState title={empty} />;
  const sorted = [...changes].sort((a, b) => pathOf(a).localeCompare(pathOf(b)));
  return (
    <ul className="change-list">
      {sorted.map((change) => {
        const path = pathOf(change);
        const after = change.kind === 'deleted' ? null : change.after;
        const format = after && previewFormat(after.path);
        return (
          <li key={change.itemId} className={`change-row is-${change.kind}`}>
            <FileGlyph path={path} />
            <span className="change-path">
              <span className="mono">{path}</span>
              <span className="change-verb">
                <StatusBadge tone={change.kind === 'added' ? 'signal' : change.kind === 'deleted' ? 'danger' : 'quiet'}>{change.kind === 'added' ? 'Added' : change.kind === 'deleted' ? 'Removed' : 'Edited'}</StatusBadge>
                {change.kind === 'modified' && change.moved && <span className="muted"> {changeVerb(change)}</span>}
              </span>
            </span>
            {after && (
              <span className="cell-action">
                {format && <PreviewButton projectId={projectId} sha256={after.blob} path={after.path} format={format} />}
                <DownloadButton projectId={projectId} sha256={after.blob} path={after.path} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const pathOf = (change: ItemChange) => (change.kind === 'deleted' ? change.before.path : change.after.path);
