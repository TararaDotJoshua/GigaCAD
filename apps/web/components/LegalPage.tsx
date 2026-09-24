export interface LegalSection {
  id: string;
  title: string;
  body: React.ReactNode;
}

export function LegalPage({
  title,
  updated,
  summary,
  sections,
}: {
  title: string;
  updated: string;
  summary: React.ReactNode[];
  sections: LegalSection[];
}) {
  return (
    <>
      <section className="page-head page-head-compact">
        <div className="container page-head-inner">
          <div className="page-head-copy">
            <h1 className="page-title">{title}</h1>
            <p className="page-updated">Last updated {updated}</p>
          </div>
        </div>
      </section>

      <div className="container legal-layout">
        <nav className="legal-toc" aria-label="On this page">
          <p className="legal-toc-title">On this page</p>
          <ol>
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="prose">
          <aside className="legal-summary" aria-label="Summary">
            <h2>The short version</h2>
            <ul>
              {summary.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            <p>The full text below is what applies.</p>
          </aside>

          {sections.map((s) => (
            <section key={s.id} id={s.id} className="legal-section">
              <h2>{s.title}</h2>
              {s.body}
            </section>
          ))}
        </article>
      </div>
    </>
  );
}
