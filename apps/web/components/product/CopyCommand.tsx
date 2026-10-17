'use client';

import { useState } from 'react';

/** Commands to paste into a terminal, with a button that copies them. */
export function CopyCommand({ command, label = 'Copy commands' }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-command">
      <pre className="getting-started-code mono">{command}</pre>
      <button
        type="button"
        className="btn btn-secondary btn-small"
        onClick={async () => {
          await navigator.clipboard?.writeText(command).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? 'Copied' : label}
      </button>
      <span className="sr-only" role="status">
        {copied ? 'Copied to the clipboard' : ''}
      </span>
    </div>
  );
}
