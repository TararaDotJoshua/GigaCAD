'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const key = (projectId: string) => `gigacad:welcome-dismissed:${projectId}`;

/**
 * For someone added to a project who can work on it: the first steps, until they dismiss it.
 * Hidden until mounted, since whether it was dismissed lives in this browser.
 */
export function MemberWelcome({ projectId, name, role, branchesHref }: { projectId: string; name: string; role: 'maintainer' | 'contributor'; branchesHref: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    try {
      setShown(localStorage.getItem(key(projectId)) !== '1');
    } catch {
      setShown(true);
    }
  }, [projectId]);
  if (!shown) return null;
  return (
    <section className="card member-welcome" aria-labelledby="member-welcome-heading">
      <h2 id="member-welcome-heading">Start working on {name}</h2>
      <p className="card-intro">
        You’re a {role} here. Create a branch from the latest release, check it out with <code className="mono">giga checkout</code> so only you can save to it, and open a release request when it’s ready.
      </p>
      <div className="form-actions">
        <Link className="btn btn-primary btn-small" href={branchesHref}>
          Go to branches
        </Link>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => {
            try {
              localStorage.setItem(key(projectId), '1');
            } catch {}
            setShown(false);
          }}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
