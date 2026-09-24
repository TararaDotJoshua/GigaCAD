import Link from "next/link";
import { Logo } from "./Logo";
import { APP_URL } from "./site";

export function SiteHeader() {
  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link href="/" aria-label="GigaCAD home">
          <Logo />
        </Link>
        <nav className="nav-links" aria-label="Main">
          <Link href="/#how">How it works</Link>
          <Link href="/#features">Features</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/download">Download</Link>
        </nav>
        <div className="nav-actions">
          <a className="nav-login" href={`${APP_URL}/login`}>
            Log in
          </a>
          <a className="button button-small" href={`${APP_URL}/signup`}>
            Start a project
          </a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <Logo />
        <nav className="footer-links" aria-label="Footer">
          <Link href="/docs">Docs</Link>
          <Link href="/download">Download</Link>
          <a href={`${APP_URL}/login`}>Log in</a>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
        <p className="footer-legal">© 2026 GigaCAD</p>
      </div>
    </footer>
  );
}
