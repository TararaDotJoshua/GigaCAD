import { NextResponse } from 'next/server';
import { ApiError, apiRequest, type Project } from '../../../../../../../lib/api';
import { apiUrl } from '../../../../../../../lib/config';
import { releasePath } from '../../../../../../../lib/paths';
import { parseNumber } from '../../../../../../../lib/product';
import { getAccessToken } from '../../../../../../../lib/session';

/**
 * "Download all" for a release: the API's zip, streamed through with the visitor's session.
 * Nothing is buffered here, so assemblies of any size pass straight through.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ owner: string; project: string; number: string }> }) {
  const { owner, project: slug, number } = await params;
  const token = await getAccessToken();
  let projectId: string;
  try {
    projectId = (await apiRequest<Project>(token, `/v1/users/${encodeURIComponent(owner)}/projects/${encodeURIComponent(slug)}`)).id;
  } catch (error) {
    // A private project looks missing when signed out. Say so as a page, not a redirect to
    // the login form, which the browser would quietly save as the download.
    if (error instanceof ApiError && error.status === 404 && !token) return signedOut(releasePath(owner, slug, parseNumber(number)));
    if (error instanceof ApiError) return new NextResponse('Not found', { status: 404 });
    throw error;
  }
  const upstream = await fetch(new URL(`/v1/projects/${projectId}/releases/${parseNumber(number)}/archive`, apiUrl()), {
    cache: 'no-store',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!upstream.ok || !upstream.body) return new NextResponse('This release couldn’t be downloaded. Try again.', { status: upstream.status === 404 ? 404 : 502 });
  return new NextResponse(upstream.body, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'attachment',
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
