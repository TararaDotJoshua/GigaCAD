/** Placeholder rows shaped like the list they stand in for, while it loads. */
export function SkeletonRows({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <ul className="rows skeleton" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index}>
          <span className="skeleton-bar" style={{ width: `${[46, 62, 38, 54, 42][index % 5]}%` }} />
          <span className="skeleton-bar is-short" />
        </li>
      ))}
    </ul>
  );
}

/** The window before the first state arrives: the sidebar and a list, as shapes. */
export function AppSkeleton() {
  return (
    <div className="app" aria-busy="true" aria-label="Loading GigaCAD">
      <aside className="sidebar">
        <div className="sidebar-top drag" />
        <div className="sidebar-scroll">
          {[70, 55, 62].map((width, index) => (
            <span key={index} className="skeleton-bar is-nav" style={{ width: `${width}%` }} />
          ))}
        </div>
      </aside>
      <main className="main">
        <header className="toolbar drag">
          <span className="skeleton-bar" style={{ width: 180 }} />
        </header>
        <div className="content">
          <section className="panel">
            <SkeletonRows rows={5} />
          </section>
        </div>
      </main>
    </div>
  );
}
