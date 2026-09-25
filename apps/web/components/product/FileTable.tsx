import type { ManifestEntry } from '@gigacad/core';
import { DownloadButton } from './DownloadButton';
import { FileGlyph } from './FileGlyph';

/** The files of one snapshot, sorted as the API returns them (by path). */
export function FileTable({ projectId, files, download = true }: { projectId: string; files: readonly ManifestEntry[]; download?: boolean }) {
  return (
    <table className="data-table file-table">
      <thead>
        <tr>
          <th scope="col">File</th>
          <th scope="col">Item</th>
          {download && (
            <th scope="col">
              <span className="sr-only">Download</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {files.map((file) => (
          <tr key={file.itemId}>
            <td>
              <span className="file-cell">
                <FileGlyph path={file.path} />
                <span className="mono">{file.path}</span>
              </span>
            </td>
            <td className="mono muted" title={file.itemId}>
              {file.itemId.slice(0, 8)}
            </td>
            {download && (
              <td className="cell-action">
                <DownloadButton projectId={projectId} sha256={file.blob} path={file.path} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
