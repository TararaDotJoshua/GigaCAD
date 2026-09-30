import { NextResponse } from 'next/server';
import { ApiError } from '../../../../../../../lib/api';
import { apiUrl } from '../../../../../../../lib/config';
import { getProject, parseNumber } from '../../../../../../../lib/product';
import { getAccessToken } from '../../../../../../../lib/session';

/**
 * "Download all" for a release: the API's zip, streamed through with the visitor's session.
 * Nothing is buffered here, so assemblies of any size pass straight through.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ owner: string; project: string; number: string }> }) {
  const { owner, project: slug, number } = await params;
  let projectId: string;
  try {
    projectId = (await getProject(owner, slug)).id;
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse('Not found', { status: 404 });
    throw error;
  }
  const token = await getAccessToken();
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
