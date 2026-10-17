import Link from 'next/link';

/**
 * The body of a product 404 or error page: what happened in a sentence, and ways onward.
 * Signed-out visitors (`login` set) get "Log in" in place of "Your projects".
 */
export function ProblemPanel({ title, children, home, action, login }: { title: string; children: React.ReactNode; home: string; action?: React.ReactNode; login?: string }) {
  return (
    <div className="page page-narrow problem">
      <h1 className="app-title">{title}</h1>
      <div className="problem-body">{children}</div>
      <div className="problem-actions">
        {action}
        {login ? (
          <Link href={login} className="btn btn-secondary">
            Log in
          </Link>
        ) : (
          <Link href={home} className="btn btn-secondary">
            Your projects
          </Link>
        )}
        <Link href="/explore" className="btn btn-secondary">
          Explore
        </Link>
      </div>
    </div>
  );
}
