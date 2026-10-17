import Link from 'next/link';
import { SiteFooter, SiteHeader } from './SiteChrome';

/** Where a missing marketing address points back to, by its first segment. */
const SECTIONS: Readonly<Record<string, { href: string; label: string; text: string }>> = {
  docs: { href: '/docs', label: 'Browse the docs', text: 'There’s no docs page at this address. It may have moved, or the link may be mistyped.' },
  newsroom: { href: '/newsroom', label: 'All news', text: 'There’s no article at this address. It may have moved, or the link may be mistyped.' },
};

/** A 404 for the site's own pages (docs, newsroom, pricing), in the site's frame rather than the product's. */
export function SiteNotFound({ section }: { section?: string }) {
  const back = section ? SECTIONS[section] : undefined;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <section className="page-head">
          <div className="container page-head-inner">
            <div className="page-head-copy">
              <h1 className="page-title">Page not found</h1>
              <p className="lead">{back?.text ?? 'There’s nothing at this address. It may have moved, or the link may be mistyped.'}</p>
              <p>
                <Link className="button" href={back?.href ?? '/'}>
                  {back?.label ?? 'GigaCAD home'}
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
