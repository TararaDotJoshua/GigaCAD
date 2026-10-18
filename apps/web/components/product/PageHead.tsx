import Link from 'next/link';

export interface Crumb {
  readonly label: string;
  readonly href?: string;
  /** A real file, folder, or branch name, set in mono like the file tables. */
  readonly mono?: boolean;
}

/** Past this many breadcrumbs, the middle ones fold into a "…" menu: deep folders would otherwise take many lines. */
const CRUMBS_SHOWN = 5;

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
  const folded = crumbs.length > CRUMBS_SHOWN ? crumbs.slice(2, -2) : [];
  const shown: readonly (Crumb | null)[] = folded.length ? [...crumbs.slice(0, 2), null, ...crumbs.slice(-2)] : crumbs;
  return (
    <header className="page-header">
      <div className="page-header-text">
        {crumbs.length > 0 && (
          <nav className="app-crumbs" aria-label="Breadcrumbs">
            {shown.map((crumb, index) => (
              <span key={`${crumb?.label ?? '…'}-${index}`}>
                {index > 0 && <span className="crumb-sep"> / </span>}
                {crumb === null ? (
                  <details className="menu crumb-more">
                    <summary title={folded.map((hidden) => hidden.label).join(' / ')} aria-label={`${folded.length} more folders`}>
                      …
                    </summary>
                    <div className="menu-list">
                      {folded.map((hidden, at) =>
                        hidden.href ? (
                          <Link key={at} href={hidden.href} className={hidden.mono ? 'mono' : undefined}>
                            {hidden.label}
                          </Link>
                        ) : (
                          <span key={at} className={hidden.mono ? 'mono' : undefined}>
                            {hidden.label}
                          </span>
                        ),
                      )}
                    </div>
                  </details>
                ) : crumb.href ? (
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
