'use client';

import { useSyncExternalStore } from 'react';
import { dashboardPath } from '../../lib/hosts';
import { ProblemPanel } from './ProblemPanel';

const subscribe = (change: () => void) => {
  window.addEventListener('online', change);
  window.addEventListener('offline', change);
  return () => {
    window.removeEventListener('online', change);
    window.removeEventListener('offline', change);
  };
};

/** An error page's body. When the browser is offline it says so, instead of blaming the server. */
export function LoadError({ reset }: { reset: () => void }) {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  return (
    <ProblemPanel title={online ? 'This page didn’t load' : 'You’re offline'} home={dashboardPath()} action={<button type="button" className="btn btn-primary" onClick={reset}>Try again</button>}>
      <p>{online ? 'Something went wrong on our side. Your files are safe. Try again in a moment.' : 'This page needs a connection. Reconnect, then try again. Your files are safe.'}</p>
    </ProblemPanel>
  );
}
