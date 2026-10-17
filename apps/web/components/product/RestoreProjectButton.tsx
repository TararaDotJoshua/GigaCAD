'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { restoreProject, type ActionState } from '../../app/(product)/actions';
import { dashboardPath } from '../../lib/hosts';
import { FormStatus } from './ActionButton';

/**
 * Restores a deleted project. Its files count toward storage again, so when they no longer
 * fit, it says how much is needed and where to make room.
 */
export function RestoreProjectButton({ projectId, billingEnabled }: { projectId: string; billingEnabled: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  return (
    <span className="action">
      <button type="button" className="btn btn-secondary btn-small" disabled={pending} onClick={() => start(async () => setState(await restoreProject(projectId)))}>
        {pending ? 'Restoring…' : 'Restore'}
      </button>
      {state.storageFull ? (
        <span className="form-status is-error" role="alert">
          {state.error}{' '}
          {billingEnabled ? (
            <Link href="/settings/billing?from=%2Fsettings%23deleted">Upgrade</Link>
          ) : (
            <Link href={dashboardPath()}>Free up space by deleting a project</Link>
          )}
        </span>
      ) : (
        <FormStatus state={state} />
      )}
    </span>
  );
}
