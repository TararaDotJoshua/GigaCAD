import { ARTICLE_KINDS, getArticles } from "../../../../lib/newsroom";

export const dynamic = "force-static";

const SITE_URL = "https://gigacad.site";

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** RSS 2.0 for feed readers: titles, summaries, and links, newest first. */
export function GET() {
  const items = getArticles()
    .map((article) => {
      const url = `${SITE_URL}/newsroom/${article.slug}`;
      return `    <item>
      <title>${escape(article.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${escape(article.summary)}</description>
      <category>${ARTICLE_KINDS[article.kind]}</category>
      <pubDate>${new Date(`${article.date}T00:00:00Z`).toUTCString()}</pubDate>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>GigaCAD Newsroom</title>
    <link>${SITE_URL}/newsroom</link>
    <description>Essays, roadmaps, and news from the people building GigaCAD.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
