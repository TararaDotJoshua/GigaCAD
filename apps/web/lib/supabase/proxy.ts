import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isAsset, isMarketingPath, isPublicAuthPath, isPublicBrowsePath, routeRequest, sites } from '../hosts';
import { supabaseConfig } from '../config';

/** Splits the marketing and product hosts, refreshes the Supabase session, and sends signed-out visitors to log in (except on public pages). */
export async function updateSession(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const route = routeRequest(request.headers.get('host') ?? request.nextUrl.host, pathname, search, sites());
  if (route.kind === 'redirect') return NextResponse.redirect(route.url, 308);
  const effectivePath = route.kind === 'rewrite' ? route.pathname : pathname;
  const next = () => {
    if (route.kind !== 'rewrite') return NextResponse.next({ request });
    const url = request.nextUrl.clone();
    url.pathname = route.pathname;
    return NextResponse.rewrite(url, { request });
  };
  if (isAsset(pathname) || isMarketingPath(effectivePath)) return next();

  const { url, key } = supabaseConfig();
  let response = next();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && !isPublicAuthPath(effectivePath) && !isPublicBrowsePath(effectivePath)) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = '';
    login.searchParams.set('next', pathname + search);
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }
  return response;
}
