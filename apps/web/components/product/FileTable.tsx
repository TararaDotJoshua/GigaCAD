import type { ManifestEntry } from '@gigacad/core';
import { exportFilename, isSolidWorks, previewFormat } from '../../lib/preview';
import { getFileExports, getThumbnails } from '../../lib/product';
import { DownloadButton } from './DownloadButton';
import { FileGlyph } from './FileGlyph';
import { PreviewButton } from './PreviewButton';

/** The files of one snapshot, sorted as the API returns them (by path), with thumbnails where they're ready. */
export async function FileTable({ projectId, files, download = true }: { projectId: string; files: readonly ManifestEntry[]; download?: boolean }) {
  const solidWorks = files.filter((file) => isSolidWorks(file.path)).map((file) => file.blob);
  const [thumbnails, exports] = await Promise.all([
    getThumbnails(projectId, files.filter((file) => previewFormat(file.path) || isSolidWorks(file.path)).map((file) => file.blob)),
    getFileExports(projectId, solidWorks),
  ]);
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
          const fileExports = exports[file.blob] ?? [];
          // A SolidWorks file previews from its STL export, or else its STEP export.
          const model = fileExports.find((entry) => entry.format === 'stl') ?? fileExports.find((entry) => entry.format === 'step');
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
                {format ? (
                  <PreviewButton projectId={projectId} sha256={file.blob} path={file.path} format={format} />
                ) : (
                  model && <PreviewButton projectId={projectId} sha256={model.sha256} path={file.path} format={model.format} />
                )}
                {fileExports.map((entry) => (
                  <DownloadButton
                    key={entry.format}
                    projectId={projectId}
                    sha256={entry.sha256}
                    path={file.path}
                    filename={exportFilename(file.path, entry.format)}
                    label={entry.format.toUpperCase()}
                  />
                ))}
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
