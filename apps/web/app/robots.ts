import type { MetadataRoute } from 'next';
import { sites } from '../lib/hosts';

/** Crawlers may read the marketing site and public projects, not account pages or sign-in forms. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/app', '/settings', '/new$', '/device', '/billing', '/login', '/signup', '/forgot-password', '/reset-password', '/auth/'],
    },
    sitemap: `${sites().siteUrl}/sitemap.xml`,
  };
}
