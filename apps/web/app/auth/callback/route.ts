import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { safeReturnPath } from '../../../lib/return-path';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeReturnPath(url.searchParams.get('next'));
  const code = url.searchParams.get('code');
  if (code) {
    const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL('/login?error=callback', url.origin));
}
