/** Placeholder shapes while a product page loads: a head, a table, and (for project pages) the rail. Static, since nothing animates on its own. */
export function PageSkeleton({ rail = false, rows = 6 }: { rail?: boolean; rows?: number }) {
  const table = (
    <div className="skeleton-table">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row">
          <span className="skeleton skeleton-glyph" />
          <span className="skeleton skeleton-line" style={{ width: `${40 + ((index * 17) % 35)}%` }} />
        </div>
      ))}
    </div>
  );
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="page-header">
        <div className="page-header-text">
          <span className="skeleton skeleton-crumbs" />
          <span className="skeleton skeleton-title" />
        </div>
      </div>
      {rail ? (
        <div className="page-grid">
          {table}
          <div className="stack">
            <span className="skeleton skeleton-card" />
            <span className="skeleton skeleton-card" />
          </div>
        </div>
      ) : (
        table
      )}
    </div>
  );
}
