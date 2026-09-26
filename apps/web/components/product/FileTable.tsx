import type { ManifestEntry } from '@gigacad/core';
import { previewFormat } from '../../lib/preview';
import { getThumbnails } from '../../lib/product';
import { DownloadButton } from './DownloadButton';
import { FileGlyph } from './FileGlyph';
import { PreviewButton } from './PreviewButton';

/** The files of one snapshot, sorted as the API returns them (by path), with thumbnails where they're ready. */
export async function FileTable({ projectId, files, download = true }: { projectId: string; files: readonly ManifestEntry[]; download?: boolean }) {
  const thumbnails = await getThumbnails(projectId, files.filter((file) => previewFormat(file.path)).map((file) => file.blob));
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
        {files.map((file) => {
          const format = previewFormat(file.path);
          return (
          <tr key={file.itemId}>
            <td>
              <span className="file-cell">
                <FileGlyph path={file.path} thumbnailUrl={thumbnails[file.blob]} />
                <span className="mono">{file.path}</span>
              </span>
            </td>
            <td className="mono muted" title={file.itemId}>
              {file.itemId.slice(0, 8)}
            </td>
            {download && (
              <td className="cell-action">
                {format && <PreviewButton projectId={projectId} sha256={file.blob} path={file.path} format={format} />}
                <DownloadButton projectId={projectId} sha256={file.blob} path={file.path} />
              </td>
            )}
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}
