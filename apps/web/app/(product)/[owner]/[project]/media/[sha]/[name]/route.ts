import { NextResponse } from 'next/server';
import { ApiError, apiRequest, type Project } from '../../../../../../../lib/api';
import { isMediaRequest } from '../../../../../../../lib/readme';
import { getAccessToken } from '../../../../../../../lib/session';

/**
 * An image or video a README embeds (see mediaPath). Storage links expire after an hour, so
 * the page holds this address instead: each request checks, with the visitor's session if they
 * have one, that they can see the project and that the file is in it, then redirects to a fresh
 * link. Browsers reuse the redirect for five minutes, well inside that hour.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ owner: string; project: string; sha: string; name: string }> }) {
  const { owner, project: slug, sha, name } = await params;
  const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'cache-control': 'private, no-store' } });
  if (!isMediaRequest(sha, name)) return notFound();
  const token = await getAccessToken();
  try {
    const project = await apiRequest<Project>(token, `/v1/users/${encodeURIComponent(owner)}/projects/${encodeURIComponent(slug)}`);
    const plan = await apiRequest<{ downloads: { sha256: string; url: string }[] }>(token, `/v1/projects/${project.id}/blobs/downloads`, {
      method: 'POST',
      body: JSON.stringify({ sha256s: [sha], filenames: { [sha]: name }, inline: true }),
    });
    const url = plan.downloads.find((download) => download.sha256 === sha)?.url;
    if (!url) return notFound();
    return new NextResponse(null, { status: 302, headers: { location: url, 'cache-control': 'private, max-age=300' } });
  } catch (error) {
    // Private projects look missing to outsiders, the same as ones that aren't there.
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) return notFound();
    return new NextResponse('This file couldn’t be loaded. Try again.', { status: 502, headers: { 'cache-control': 'private, no-store' } });
  }
}
