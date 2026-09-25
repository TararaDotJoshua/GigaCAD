/**
 * One Next.js app serves two sites: marketing at gigacad.site and the product at
 * app.gigacad.site. The request's host decides which pages it may see. When both
 * URLs share a host (local development) nothing is split.
 */

export interface Sites {
  /** e.g. https://gigacad.site */
  readonly siteUrl: string;
  /** e.g. https://app.gigacad.site */
  readonly appUrl: string;
}

export type Route =
  | { readonly kind: 'next' }
  | { readonly kind: 'rewrite'; readonly pathname: string }
  | { readonly kind: 'redirect'; readonly url: string };

/** Pages that belong to the marketing site. Everything else is the product. */
export function isMarketingPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    ['/download', '/docs', '/privacy', '/terms'].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

/** Sign-in pages that work without a session. */
export function isPublicAuthPath(pathname: string): boolean {
  return ['/login', '/signup', '/forgot-password', '/reset-password', '/auth'].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Files served as-is on both hosts: Next's own assets and top-level files like
 * /favicon.ico. Deeper paths with dots are pages (branch names and slugs may contain dots).
 */
export function isAsset(pathname: string): boolean {
  return pathname.startsWith('/_next/') || /^\/[^/]+\.[a-z0-9]+$/i.test(pathname);
}

export function routeRequest(host: string, pathname: string, search: string, sites: Sites): Route {
  const site = new URL(sites.siteUrl);
  const app = new URL(sites.appUrl);
  if (site.host === app.host || isAsset(pathname)) return { kind: 'next' };
  const requested = host.toLowerCase();

  if (requested === app.host) {
    if (pathname === '/') return { kind: 'rewrite', pathname: '/app' };
    if (pathname === '/app' || pathname.startsWith('/app/')) {
      return { kind: 'redirect', url: new URL(`${pathname.slice(4) || '/'}${search}`, app).toString() };
    }
    if (isMarketingPath(pathname)) return { kind: 'redirect', url: new URL(`${pathname}${search}`, site).toString() };
    return { kind: 'next' };
  }

  if (requested === site.host) {
    if (isMarketingPath(pathname)) return { kind: 'next' };
    const target = pathname === '/app' ? '/' : pathname;
    return { kind: 'redirect', url: new URL(`${target}${search}`, app).toString() };
  }

  // Unknown hosts (previews, raw worker URLs) get the whole app unsplit.
  return { kind: 'next' };
}

/**
 * Production sets both URLs. Local development usually sets only the app URL
 * (http://localhost:3000), and then both sites share that host.
 */
export function sites(): Sites {
  const appUrl = process.env.NEXT_PUBLIC_GIGACAD_APP_URL;
  return {
    siteUrl: process.env.NEXT_PUBLIC_GIGACAD_SITE_URL ?? appUrl ?? 'https://gigacad.site',
    appUrl: appUrl ?? 'https://app.gigacad.site',
  };
}

/** Where the dashboard lives: `/` on a split app host, `/app` when everything shares one host. */
export function dashboardPath(): string {
  const { siteUrl, appUrl } = sites();
  return new URL(siteUrl).host === new URL(appUrl).host ? '/app' : '/';
}
