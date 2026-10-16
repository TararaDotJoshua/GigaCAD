import { Logo } from '../components/Logo';
import { APP_URL } from '../components/site';
import { dashboardPath, sites } from '../lib/hosts';
import { getAccessToken } from '../lib/session';

export const metadata = { title: 'Page not found' };

// Addresses that match no page at all. Styled like the sign-in pages: Forest, one card.
export default async function NotFound() {
  const { siteUrl } = sites();
  const signedIn = Boolean(await getAccessToken());
  return (
    <>
      <header className="auth-nav">
        <a href={siteUrl} aria-label="GigaCAD home"><Logo /></a>
      </header>
      <main id="main" className="auth-shell">
        <div className="auth-card">
          <h1>Page not found</h1>
          <p className="auth-intro">There’s nothing at this address. It may have moved, or the link may be mistyped.</p>
          <div className="auth-links">
            <a href={siteUrl}>GigaCAD home</a>
            {signedIn ? <a href={dashboardPath()}>Your projects</a> : <a href={`${APP_URL}/login`}>Log in</a>}
          </div>
        </div>
      </main>
    </>
  );
}
