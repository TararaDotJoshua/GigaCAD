import { Logo } from '../../components/Logo';
import { sites } from '../../lib/hosts';

// The logo and "Back to site" go to the marketing site. On the app host, `/` is the dashboard, which sends signed-out visitors straight back here.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { siteUrl } = sites();
  return <><header className="auth-nav"><a href={siteUrl} aria-label="GigaCAD home"><Logo /></a><a href={siteUrl}>Back to site</a></header><main id="main">{children}</main></>;
}
