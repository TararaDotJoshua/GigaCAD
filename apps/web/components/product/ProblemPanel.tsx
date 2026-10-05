import Link from 'next/link';

/** The body of a product 404 or error page: what happened in a sentence, and ways onward. */
export function ProblemPanel({ title, children, home, action }: { title: string; children: React.ReactNode; home: string; action?: React.ReactNode }) {
  return (
    <div className="page page-narrow problem">
      <h1 className="app-title">{title}</h1>
      <div className="problem-body">{children}</div>
      <div className="problem-actions">
        {action}
        <Link href={home} className="btn btn-secondary">
          Your projects
        </Link>
        <Link href="/explore" className="btn btn-secondary">
          Explore
        </Link>
      </div>
    </div>
  );
}
