import Link from "next/link";
import { HeaderAccount, SiteAccountLink } from "./AccountLinks";
import { Logo } from "./Logo";
import { SiteMenu, SiteNav } from "./SiteNav";
import { APP_URL } from "./site";

export function SiteHeader() {
  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link href="/" aria-label="GigaCAD home">
          <Logo />
        </Link>
        <SiteNav />
        <div className="nav-actions">
          <HeaderAccount />
          <SiteMenu />
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
          <Link href="/pricing">Pricing</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/newsroom">Newsroom</Link>
          <a href={`${APP_URL}/explore`}>Explore</a>
          <Link href="/download">Desktop app</Link>
          <SiteAccountLink />
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
        <p className="footer-legal">© 2026 GigaCAD</p>
      </div>
    </footer>
  );
}
