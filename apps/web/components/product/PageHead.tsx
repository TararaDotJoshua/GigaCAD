import Link from 'next/link';

export interface Crumb {
  readonly label: string;
  readonly href?: string;
  /** A real file, folder, or branch name, set in mono like the file tables. */
  readonly mono?: boolean;
}

/** Breadcrumbs, the page title, and a meta line, as in the release request window on the home page. */
export function PageHead({
  crumbs,
  title,
  meta,
  actions,
}: {
  crumbs: readonly Crumb[];
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {crumbs.length > 0 && (
          <nav className="app-crumbs" aria-label="Breadcrumbs">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`}>
                {index > 0 && <span className="crumb-sep"> / </span>}
                {crumb.href ? (
                  <Link href={crumb.href} className={crumb.mono ? 'mono' : undefined}>
                    {crumb.label}
                  </Link>
                ) : crumb.mono ? (
                  <span className="mono">{crumb.label}</span>
                ) : (
                  crumb.label
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="app-title">{title}</h1>
        {meta && <div className="app-meta">{meta}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
