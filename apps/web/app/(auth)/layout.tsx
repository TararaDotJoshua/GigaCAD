import Link from 'next/link';
import { Logo } from '../../components/Logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <><header className="auth-nav"><Link href="/" aria-label="GigaCAD home"><Logo /></Link><Link href="/">Back to site</Link></header><main id="main">{children}</main></>;
}
