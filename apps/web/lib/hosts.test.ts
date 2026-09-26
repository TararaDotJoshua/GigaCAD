import { describe, expect, it } from 'vitest';
import { isAsset, isPublicBrowsePath, routeRequest } from './hosts';

const prod = { siteUrl: 'https://gigacad.site', appUrl: 'https://app.gigacad.site' };
const local = { siteUrl: 'http://localhost:3000', appUrl: 'http://localhost:3000' };

describe('routeRequest', () => {
  it('serves marketing pages on gigacad.site and sends everything else to the app', () => {
    expect(routeRequest('gigacad.site', '/', '', prod)).toEqual({ kind: 'next' });
    expect(routeRequest('gigacad.site', '/docs/branches', '', prod)).toEqual({ kind: 'next' });
    expect(routeRequest('gigacad.site', '/login', '?next=%2Fnew', prod)).toEqual({ kind: 'redirect', url: 'https://app.gigacad.site/login?next=%2Fnew' });
    expect(routeRequest('gigacad.site', '/alex/robot', '', prod)).toEqual({ kind: 'redirect', url: 'https://app.gigacad.site/alex/robot' });
    expect(routeRequest('gigacad.site', '/app', '', prod)).toEqual({ kind: 'redirect', url: 'https://app.gigacad.site/' });
  });

  it('shows the dashboard at the app root and sends marketing pages back', () => {
    expect(routeRequest('app.gigacad.site', '/', '', prod)).toEqual({ kind: 'rewrite', pathname: '/app' });
    expect(routeRequest('APP.gigacad.site', '/alex/robot/branches/v1.2', '', prod)).toEqual({ kind: 'next' });
    expect(routeRequest('app.gigacad.site', '/app', '?device=approved', prod)).toEqual({ kind: 'redirect', url: 'https://app.gigacad.site/?device=approved' });
    expect(routeRequest('app.gigacad.site', '/app/x', '', prod)).toEqual({ kind: 'redirect', url: 'https://app.gigacad.site/x' });
    expect(routeRequest('app.gigacad.site', '/download', '', prod)).toEqual({ kind: 'redirect', url: 'https://gigacad.site/download' });
    expect(routeRequest('app.gigacad.site', '/device', '?code=ABCD-2345', prod)).toEqual({ kind: 'next' });
    expect(routeRequest('app.gigacad.site', '/pricing', '', prod)).toEqual({ kind: 'redirect', url: 'https://gigacad.site/pricing' });
    expect(routeRequest('gigacad.site', '/billing/checkout', '?plan=maker&interval=yearly', prod)).toEqual({
      kind: 'redirect',
      url: 'https://app.gigacad.site/billing/checkout?plan=maker&interval=yearly',
    });
  });

  it('does not split when both sites share a host, or on unknown hosts', () => {
    expect(routeRequest('localhost:3000', '/app', '', local)).toEqual({ kind: 'next' });
    expect(routeRequest('localhost:3000', '/', '', local)).toEqual({ kind: 'next' });
    expect(routeRequest('gigacad-web.workers.dev', '/login', '', prod)).toEqual({ kind: 'next' });
  });

  it('leaves assets alone', () => {
    expect(routeRequest('app.gigacad.site', '/favicon.ico', '', prod)).toEqual({ kind: 'next' });
    expect(isAsset('/_next/static/chunk.js')).toBe(true);
    expect(isAsset('/alex/robot.v2')).toBe(false);
  });

  it('lets signed-out visitors browse profiles, projects, and Explore, but not account pages', () => {
    for (const path of ['/explore', '/alex', '/alex/robot', '/alex/robot/releases/2']) expect(isPublicBrowsePath(path), path).toBe(true);
    for (const path of ['/', '/app', '/new', '/settings', '/settings/billing', '/billing/checkout', '/device', '/login']) expect(isPublicBrowsePath(path), path).toBe(false);
  });
});
