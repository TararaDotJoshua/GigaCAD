import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { dashboardPath, isAsset, isMarketingPath, isPublicAuthPath, isPublicBrowsePath, routeRequest, sites } from '../hosts';
import { CURRENT_PATH_HEADER } from '../current-path';
import { safeReturnPath } from '../return-path';
import { supabaseConfig } from '../config';

/** Splits the marketing and product hosts, refreshes the Supabase session, and sends signed-out visitors to log in (except on public pages). */
export async function updateSession(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const route = routeRequest(request.headers.get('host') ?? request.nextUrl.host, pathname, search, sites());
  if (route.kind === 'redirect') return NextResponse.redirect(route.url, 308);
  const effectivePath = route.kind === 'rewrite' ? route.pathname : pathname;
  // Server code reads the page the visitor asked for from this header, so a sign-in redirect can bring them back to it.
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set(CURRENT_PATH_HEADER, pathname + search);
    if (route.kind !== 'rewrite') return NextResponse.next({ request: { headers } });
    const url = request.nextUrl.clone();
    url.pathname = route.pathname;
    return NextResponse.rewrite(url, { request: { headers } });
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
  // Someone already signed in has nothing to do on the log-in or sign-up form.
  if (data?.claims && (effectivePath === '/login' || effectivePath === '/signup')) {
    const target = request.nextUrl.clone();
    const [targetPath, targetSearch = ''] = safeReturnPath(request.nextUrl.searchParams.get('next'), dashboardPath()).split('?');
    target.pathname = targetPath!;
    target.search = targetSearch;
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }
  return response;
}
