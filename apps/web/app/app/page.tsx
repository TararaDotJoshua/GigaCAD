import { redirect } from 'next/navigation';
import { AppHome } from '../../components/AppHome';
import { apiRequest, type Profile, type Project } from '../../lib/api';
import { createClient } from '../../lib/supabase/server';

export default async function Page() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect('/login?next=%2Fapp');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect('/login?next=%2Fapp');
  try {
    const [profile, projects] = await Promise.all([
      apiRequest<Profile>(session.access_token, '/v1/me'),
      apiRequest<Project[]>(session.access_token, '/v1/projects'),
    ]);
    return <AppHome profile={profile} projects={projects} />;
  } catch {
    return <main className="app-main"><h1>Projects are unavailable.</h1><p>Check that the GigaCAD API is running, then refresh this page.</p></main>;
  }
}
