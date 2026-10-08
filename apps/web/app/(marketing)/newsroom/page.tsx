import type { Metadata } from "next";
import Link from "next/link";
import { ARTICLE_KINDS, formatArticleDate, getArticles } from "../../../lib/newsroom";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Newsroom",
  description: "Essays, roadmaps, and news from the people building GigaCAD.",
  alternates: { types: { "application/rss+xml": "/newsroom/feed.xml" } },
};

export default function NewsroomPage() {
  const articles = getArticles();

  return (
    <>
      <section className="page-head">
        <div className="hero-grid" aria-hidden="true" />
        <div className="container page-head-inner">
          <div className="page-head-copy">
            <h1 className="page-title">Newsroom.</h1>
            <p className="lead">
              Essays on how hardware teams work, where GigaCAD is going, and what just shipped.
            </p>
            <a className="text-link" href="/newsroom/feed.xml">
              Follow with RSS
            </a>
          </div>
        </div>
      </section>

      <section className="container newsroom" aria-label="Articles">
        {articles.length === 0 ? (
          <p className="body">Nothing published yet.</p>
        ) : (
          <ol className="newsroom-list">
            {articles.map((article) => (
              <li key={article.slug}>
                <article className="newsroom-item">
                  {/* The title comes first for screen readers; the meta column sits to its left on wide screens. */}
                  <div className="newsroom-copy">
                    <h2 className="newsroom-title">
                      <Link href={`/newsroom/${article.slug}`}>{article.title}</Link>
                    </h2>
                    <p>{article.summary}</p>
                  </div>
                  <div className="newsroom-meta">
                    <time dateTime={article.date}>{formatArticleDate(article.date)}</time>
                    <span className="badge">{ARTICLE_KINDS[article.kind]}</span>
                    {article.draft && <span className="badge badge-quiet">Draft</span>}
                  </div>
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
