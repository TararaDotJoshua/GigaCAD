import type { FileExport } from '../../lib/api';
import { modelFor } from '../../lib/models';
import { exportFilename } from '../../lib/preview';
import { DownloadButton } from './DownloadButton';
import { PreviewButton } from './PreviewButton';

/**
 * A file's preview and downloads, wherever files are listed: a 3D preview (from its STEP or STL
 * export for SolidWorks), a chip per export, and the file itself.
 */
export function FileActions({
  projectId,
  path,
  blob,
  size,
  exports = [],
}: {
  projectId: string;
  path: string;
  blob: string;
  size?: number;
  exports?: readonly FileExport[];
}) {
  const model = modelFor(path, blob, exports, size);
  const name = path.split('/').pop() ?? path;
  return (
    <>
      {model && (
        <PreviewButton
          projectId={projectId}
          sha256={model.sha256}
          path={path}
          format={model.format}
          size={model.size}
          source={model.source}
          fallback={model.fallback}
        />
      )}
      {exports.map((entry) => (
        <DownloadButton key={entry.format} projectId={projectId} sha256={entry.sha256} path={name} filename={exportFilename(name, entry.format)} label={entry.format.toUpperCase()} />
      ))}
      <DownloadButton projectId={projectId} sha256={blob} path={name} />
    </>
  );
}
