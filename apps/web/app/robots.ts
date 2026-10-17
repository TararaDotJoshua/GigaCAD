import type { MetadataRoute } from 'next';
import { sites } from '../lib/hosts';

/** Crawlers may read the marketing site and public projects, not account pages or sign-in forms. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Whole segments only: a handle like "apple" or "loginov" starts with a reserved word but is a profile.
      disallow: ['/app$', '/app/', '/settings$', '/settings/', '/new$', '/device$', '/device/', '/billing$', '/billing/', '/login$', '/signup$', '/forgot-password$', '/reset-password$', '/auth/'],
    },
    sitemap: `${sites().siteUrl}/sitemap.xml`,
  };
}
