import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allPages, findPage } from "../content";

export const dynamicParams = false;

export function generateStaticParams() {
  return allPages.map((p) => ({ slug: p.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = findPage((await params).slug);
  return found ? { title: `${found.page.title} | Docs`, description: found.page.summary } : {};
}

const anchor = (heading: string) =>
  heading.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default async function DocPage({ params }: Props) {
  const found = findPage((await params).slug);
  if (!found) notFound();
  const { page, prev, next } = found;
  const Body = page.body;

  return (
    <article className="doc">
      <p className="doc-section">{page.section}</p>
      <h1 className="page-title">{page.title}</h1>
      <p className="lead doc-lead">{page.summary}</p>

      <div className="prose doc-body">
        {Body ? (
          <Body />
        ) : (
          <>
            <p className="doc-draft-note">This page hasn’t been written yet. It will cover:</p>
            {page.outline.map((heading) => (
              <section key={heading} className="doc-pending">
                <h2 id={anchor(heading)}>{heading}</h2>
              </section>
            ))}
          </>
        )}
      </div>

      <nav className="doc-pager" aria-label="Previous and next page">
        {prev ? (
          <Link href={`/docs/${prev.slug}`} className="doc-pager-prev">
            <span>Previous</span>
            {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`/docs/${next.slug}`} className="doc-pager-next">
            <span>Next</span>
            {next.title}
          </Link>
        )}
      </nav>
    </article>
  );
}
