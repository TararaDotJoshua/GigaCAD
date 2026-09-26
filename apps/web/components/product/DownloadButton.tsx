'use client';

import { useState, useTransition } from 'react';
import { downloadLink } from '../../app/(product)/actions';
import { DownloadIcon } from '../icons';

/** Fetches a short-lived, named download link when clicked; links are never written into the page. */
export function DownloadButton({
  projectId,
  sha256,
  path,
  filename = path.split('/').pop() ?? path,
  label,
}: {
  projectId: string;
  sha256: string;
  path: string;
  /** The name to save as, when it differs from the file's own, like a STEP export's. */
  filename?: string;
  /** Shown instead of the download icon, like "STEP" for an export. */
  label?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const name = path.split('/').pop() ?? path;
  const description = label ? `Download ${name} as ${label}` : `Download ${filename}`;
  return (
    <button
      type="button"
      className={label ? 'icon-button text-button' : 'icon-button'}
      disabled={pending}
      aria-label={description}
      title={error || description}
      onClick={() =>
        start(async () => {
          const result = await downloadLink(projectId, sha256, filename);
          if (result.url) window.location.assign(result.url);
          else setError(result.error ?? 'Download failed');
        })
      }
    >
      {label ?? <DownloadIcon className="icon" />}
    </button>
  );
}
