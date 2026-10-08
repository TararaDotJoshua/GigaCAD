import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeftIcon } from "../../../../components/icons";
import { ARTICLE_KINDS, findArticle, formatArticleDate, getArticles, headingId } from "../../../../lib/newsroom";

export const dynamicParams = false;

export function generateStaticParams() {
  return getArticles().map((a) => ({ slug: a.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = findArticle((await params).slug);
  if (!found) return {};
  const { article } = found;
  return {
    title: article.title,
    description: article.summary,
    authors: [{ name: article.author }],
    alternates: { types: { "application/rss+xml": "/newsroom/feed.xml" } },
    openGraph: {
      type: "article",
      title: article.title,
      description: article.summary,
      publishedTime: article.date,
      authors: [article.author],
    },
  };
}

const text = (children: ReactNode): string =>
  typeof children === "string" || typeof children === "number"
    ? String(children)
    : Array.isArray(children)
      ? children.map(text).join("")
      : children && typeof children === "object" && "props" in children
        ? text((children.props as { children?: ReactNode }).children)
        : "";

// The page title is the only h1, so a stray `#` in an article becomes a section
// heading. Section headings get anchors so they can be linked to.
const components: Components = {
  h1: ({ node: _node, children, ...props }) => (
    <h2 id={headingId(text(children))} {...props}>
      {children}
    </h2>
  ),
  h2: ({ node: _node, children, ...props }) => (
    <h2 id={headingId(text(children))} {...props}>
      {children}
    </h2>
  ),
  h3: ({ node: _node, children, ...props }) => (
    <h3 id={headingId(text(children))} {...props}>
      {children}
    </h3>
  ),
  table: ({ node: _node, ...props }) => (
    <div className="prose-table" tabIndex={0} role="region" aria-label="Table">
      <table {...props} />
    </div>
  ),
};

export default async function ArticlePage({ params }: Props) {
  const found = findArticle((await params).slug);
  if (!found) notFound();
  const { article, newer, older } = found;

  return (
    <div className="container article-layout">
      <article className="article">
        <Link href="/newsroom" className="text-link article-back">
          <ArrowLeftIcon className="icon" />
          Newsroom
        </Link>

        <header className="article-head">
          <div className="newsroom-meta">
            <span className="badge">{ARTICLE_KINDS[article.kind]}</span>
            {article.draft && <span className="badge badge-quiet">Draft, not published</span>}
            <time dateTime={article.date}>{formatArticleDate(article.date)}</time>
          </div>
          <h1 className="page-title">{article.title}</h1>
          <p className="lead">{article.summary}</p>
          <p className="article-author">By {article.author}</p>
        </header>

        <div className="prose article-body">
          <Markdown remarkPlugins={[remarkGfm]} components={components}>
            {article.body}
          </Markdown>
        </div>

        {(newer || older) && (
          <nav className="doc-pager" aria-label="More articles">
            {older ? (
              <Link href={`/newsroom/${older.slug}`} className="doc-pager-prev">
                <span>Older</span>
                {older.title}
              </Link>
            ) : (
              <span />
            )}
            {newer && (
              <Link href={`/newsroom/${newer.slug}`} className="doc-pager-next">
                <span>Newer</span>
                {newer.title}
              </Link>
            )}
          </nav>
        )}
      </article>
    </div>
  );
}
