import type { MetadataRoute } from 'next';
import { allPages } from './(marketing)/docs/content';
import { sites } from '../lib/hosts';
import { getArticles } from '../lib/newsroom';

// Built once: the docs and newsroom are read from the repository at build time.
export const dynamic = 'force-static';

/** Every marketing page, docs page, and published newsroom article. */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = sites().siteUrl;
  const pages = ['/', '/pricing', '/download', '/docs', '/newsroom', '/terms', '/privacy'];
  return [
    ...pages.map((path) => ({ url: `${site}${path === '/' ? '' : path}` })),
    ...allPages.map((page) => ({ url: `${site}/docs/${page.slug}` })),
    ...getArticles()
      .filter((article) => !article.draft)
      .map((article) => ({ url: `${site}/newsroom/${article.slug}`, lastModified: article.date })),
  ];
}
