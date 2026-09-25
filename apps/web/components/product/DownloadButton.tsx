'use client';

import { useState, useTransition } from 'react';
import { downloadLink } from '../../app/(product)/actions';
import { DownloadIcon } from '../icons';

/** Fetches a short-lived, named download link when clicked; links are never written into the page. */
export function DownloadButton({ projectId, sha256, path }: { projectId: string; sha256: string; path: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const filename = path.split('/').pop() ?? path;
  return (
    <button
      type="button"
      className="icon-button"
      disabled={pending}
      aria-label={`Download ${filename}`}
      title={error || `Download ${filename}`}
      onClick={() =>
        start(async () => {
          const result = await downloadLink(projectId, sha256, filename);
          if (result.url) window.location.assign(result.url);
          else setError(result.error ?? 'Download failed');
        })
      }
    >
      <DownloadIcon className="icon" />
    </button>
  );
}
