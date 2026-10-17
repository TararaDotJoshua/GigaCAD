import { AuthForm } from '../../../components/AuthForm';
import { authQuery } from '../../../lib/auth-query';
import { sites } from '../../../lib/hosts';

export const metadata = { title: 'Reset your password' };

// Read on the server, so the form is in the first HTML instead of waiting for JavaScript.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AuthForm mode="forgot" query={await authQuery(searchParams)} siteUrl={sites().siteUrl} />;
}
