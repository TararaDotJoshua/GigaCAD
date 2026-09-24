'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { apiRequest, type Profile, type Project } from '../lib/api';
import { createClient } from '../lib/supabase/client';

export function AppHome({ profile: initialProfile, projects: initialProjects }: { profile: Profile; projects: Project[] }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [projects, setProjects] = useState(initialProjects);
  const [handle, setHandle] = useState(profile.handle.startsWith('user-') ? '' : profile.handle);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function token() {
    const supabase = createClient();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims) throw new Error('Your session expired. Log in again.');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Your session expired. Log in again.');
    return session.access_token;
  }

  async function saveHandle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const updated = await apiRequest<Profile>(await token(), '/v1/me', { method: 'PATCH', body: JSON.stringify({ handle }) });
      setProfile(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save handle.'); }
    finally { setBusy(false); }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const created = await apiRequest<Project>(await token(), '/v1/projects', { method: 'POST', body: JSON.stringify({ slug, name }) });
      setProjects([created, ...projects]); setName(''); setSlug('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create project.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setError('');
    const { error } = await createClient().auth.signOut();
    if (error) { setError(error.message); return; }
    router.push('/login'); router.refresh();
  }

  return <div className="app-shell">
    <header className="app-header"><Link href="/" className="app-brand">GigaCAD</Link><div><span>@{profile.handle}</span><button type="button" onClick={signOut}>Log out</button></div></header>
    <main className="app-main">
      <h1>Your projects.</h1>
      <p className="app-intro">Create a project or open a release in the GigaCAD drive when the Windows client is ready.</p>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {profile.handle.startsWith('user-') && <section className="app-panel"><h2>Choose your handle</h2><p>People will use it to find your public projects.</p><form onSubmit={saveHandle} className="app-inline-form"><label>Handle<input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} pattern="[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?" required /></label><button className="button" disabled={busy}>Save handle</button></form></section>}
      <section className="app-panel"><h2>New project</h2><form onSubmit={createProject} className="app-inline-form"><label>Name<input value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')); }} maxLength={100} required /></label><label>Slug<input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} pattern="[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?" required /></label><button className="button" disabled={busy}>Create project</button></form></section>
      <section className="app-panel"><h2>Projects</h2>{projects.length === 0 ? <p>No projects yet.</p> : <ul className="project-list">{projects.map((project) => <li key={project.id}><strong>{project.name}</strong><span className="mono">{project.ownerHandle}/{project.slug}</span><span>{project.visibility} · {project.latestReleaseNumber ? `v${project.latestReleaseNumber}` : 'No release yet'}</span></li>)}</ul>}</section>
    </main>
  </div>;
}
