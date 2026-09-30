import { Logo } from '../components/Logo';
import { dashboardPath, sites } from '../lib/hosts';

export const metadata = { title: 'Page not found' };

// Addresses that match no page at all. Styled like the sign-in pages: Forest, one card.
export default function NotFound() {
  const { siteUrl } = sites();
  return (
    <>
      <header className="auth-nav">
        <a href={siteUrl} aria-label="GigaCAD home"><Logo /></a>
      </header>
      <main id="main" className="auth-shell">
        <div className="auth-card">
          <h1>Page not found.</h1>
          <p className="auth-intro">There’s nothing at this address. It may have moved, or the link may be mistyped.</p>
          <div className="auth-links">
            <a href={siteUrl}>GigaCAD home</a>
            <a href={dashboardPath()}>Your projects</a>
          </div>
        </div>
      </main>
    </>
  );
}
