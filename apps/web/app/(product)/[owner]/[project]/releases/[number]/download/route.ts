import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { ApiError, apiRequest, type Project } from '../../../../../../../lib/api';
import { apiUrl } from '../../../../../../../lib/config';
import { projectPath } from '../../../../../../../lib/paths';
import { getAccessToken } from '../../../../../../../lib/session';

/**
 * "Download all" for a release: the API's zip, streamed through with the visitor's session.
 * Nothing is buffered here, so assemblies of any size pass straight through. `?exports=1`
 * adds the SolidWorks files' STEP and STL exports.
 *
 * A download that can't start goes to the release page instead: it shows the not-found and
 * sign-in pages (a route's own `notFound()` is a blank 404), or says the download failed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ owner: string; project: string; number: string }> }) {
  const { owner, project: slug, number } = await params;
  const releasePage = projectPath(owner, slug, 'releases', number);
  const failed = `${releasePage}?download=failed`;
  const token = await getAccessToken();
  const project = await apiRequest<Project>(token, `/v1/users/${encodeURIComponent(owner)}/projects/${encodeURIComponent(slug)}`).catch((error: unknown) => {
    if (error instanceof ApiError) return error;
    throw error;
  });
  // A private project looks missing when signed out. Say so as a page with a way to log in,
  // rather than a redirect chain the browser might treat as the download.
  if (project instanceof ApiError && project.status === 404 && !token) return signedOut(releasePage);
  if (project instanceof ApiError) redirect(project.status >= 400 && project.status < 500 ? releasePage : failed);
  const exports = new URL(request.url).searchParams.get('exports') === '1';
  const release = encodeURIComponent(number.replace(/^v/i, ''));
  const upstream = await fetch(new URL(`/v1/projects/${project.id}/releases/${release}/archive${exports ? '?exports=1' : ''}`, apiUrl()), {
    cache: 'no-store',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }).catch(() => null);
  // A missing release, or a number that can't be one, is the release page's not-found.
  if (upstream && upstream.status >= 400 && upstream.status < 500) redirect(releasePage);
  if (!upstream?.ok || !upstream.body) redirect(failed);
  const length = upstream.headers.get('content-length');
  return new NextResponse(upstream.body, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'attachment',
      ...(length ? { 'content-length': length } : {}),
      'cache-control': 'private, no-store',
    },
  });
}

function signedOut(page: string): NextResponse {
  const login = `/login?next=${encodeURIComponent(page)}`;
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Log in to download</title></head>` +
      `<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5">` +
      `<h1>Log in to download this release</h1><p>You’re signed out, so the release can’t be downloaded.</p>` +
      `<p><a href="${login}">Log in</a> and you’ll come back to the release.</p></body></html>`,
    { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } },
  );
}
