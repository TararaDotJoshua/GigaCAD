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
