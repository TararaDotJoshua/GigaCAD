import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Newsroom articles are Markdown files in `content/newsroom/`. The file name is the
 * URL slug, and a short header between `---` lines names the article:
 *
 *   ---
 *   title: Git and Scrum for hardware
 *   summary: One or two sentences for the list and search results.
 *   kind: essay
 *   date: 2026-10-08
 *   author: Joshua Tarara
 *   order: 1
 *   draft: true
 *   ---
 *
 * `order` is optional and only breaks ties between articles published the same day:
 * higher comes first. Pages are generated at build time, so the files are only read then. Drafts show in
 * development and are left out of production builds.
 */

export const ARTICLE_KINDS = {
  essay: 'Essay',
  roadmap: 'Roadmap',
  news: 'News',
} as const;

export type ArticleKind = keyof typeof ARTICLE_KINDS;

export interface Article {
  slug: string;
  title: string;
  summary: string;
  kind: ArticleKind;
  /** `YYYY-MM-DD`, the day the article is published. */
  date: string;
  author: string;
  /** Breaks ties between articles on the same date; higher comes first. Defaults to 0. */
  order: number;
  draft: boolean;
  /** Markdown, without the header. */
  body: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Reads one article file. Throws with the file's name when the header is incomplete, so a bad article fails the build. */
export function parseArticle(slug: string, source: string): Article {
  const fail = (problem: string): never => {
    throw new Error(`content/newsroom/${slug}.md: ${problem}`);
  };
  if (!SLUG_PATTERN.test(slug)) fail('file names must be lowercase words joined by dashes');

  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) fail('the file must start with a header between --- lines');
  const [, header = '', body = ''] = match!;

  const fields = new Map<string, string>();
  for (const line of header.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(':');
    if (colon < 1) fail(`can't read the header line "${line}"`);
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const required = (key: string) => fields.get(key) || fail(`the header is missing "${key}"`);

  const kind = required('kind');
  if (!(kind in ARTICLE_KINDS)) fail(`kind must be one of ${Object.keys(ARTICLE_KINDS).join(', ')}`);
  const date = required('date');
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(date))) fail('date must look like 2026-10-08');
  const order = fields.get('order') ?? '0';
  if (!/^-?\d+$/.test(order)) fail('order must be a whole number');
  const draft = fields.get('draft') ?? 'false';
  if (draft !== 'true' && draft !== 'false') fail('draft must be true or false');

  return {
    slug,
    title: required('title'),
    summary: required('summary'),
    kind: kind as ArticleKind,
    date,
    author: required('author'),
    order: Number(order),
    draft: draft === 'true',
    body: body.trim(),
  };
}

/** Newest first. Drafts are included only when `includeDrafts` is set. */
export function sortArticles(articles: Article[], includeDrafts: boolean): Article[] {
  return articles
    .filter((a) => includeDrafts || !a.draft)
    .sort((a, b) => b.date.localeCompare(a.date) || b.order - a.order || a.title.localeCompare(b.title));
}

const CONTENT_DIR = path.join(process.cwd(), 'content', 'newsroom');

/** Every article this build publishes, newest first. */
export function getArticles(): Article[] {
  const articles = readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .map((file) => parseArticle(file.slice(0, -3), readFileSync(path.join(CONTENT_DIR, file), 'utf8')));
  return sortArticles(articles, process.env.NODE_ENV !== 'production');
}

/** The article and its neighbours in the list: `newer` is above it, `older` below. */
export function findArticle(slug: string): { article: Article; newer?: Article; older?: Article } | undefined {
  const articles = getArticles();
  const index = articles.findIndex((a) => a.slug === slug);
  const article = articles[index];
  return article && { article, newer: articles[index - 1], older: articles[index + 1] };
}

/** "October 8, 2026". Dates are calendar days, so they're read and shown in UTC. */
export function formatArticleDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Turns a heading into its `id`, matching the docs' anchors. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
