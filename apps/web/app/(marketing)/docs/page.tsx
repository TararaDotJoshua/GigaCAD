import type { Metadata } from "next";
import Link from "next/link";
import { docs } from "./content";

export const metadata: Metadata = {
  title: "Docs",
  description: "Learn how to version SolidWorks projects with GigaCAD.",
  alternates: { canonical: "/docs" },
};

const start = [
  { slug: "concepts", title: "Learn the concepts", body: "Branches, versions, and releases in five minutes." },
  { slug: "first-project", title: "Make your first release", body: "Bring in an existing assembly and release v1, from the browser and the command line." },
  { slug: "cli", title: "Use the command-line tool", body: "Check out, commit, and release from a terminal." },
];

export default function DocsHome() {
  return (
    <article className="doc">
      <h1 className="page-title">GigaCAD docs</h1>
      <p className="lead doc-lead">
        How to work on branches and release SolidWorks projects with your team.
      </p>

      <ol className="doc-start">
        {start.map((s, i) => (
          <li key={s.slug}>
            <Link href={`/docs/${s.slug}`}>
              <span className="step-number" aria-hidden="true">
                {i + 1}
              </span>
              <span className="doc-start-title">{s.title}</span>
              <span className="doc-start-body">{s.body}</span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="doc-start-note">
        The desktop apps for <Link href="/docs/install-windows">Windows</Link> and <Link href="/docs/install-mac">Mac</Link> are
        coming soon. Until then, use GigaCAD in your browser and from the command line.
      </p>

      <div className="doc-index">
        {docs.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            <ul>
              {section.pages.map((page) => (
                <li key={page.slug} className={page.body ? undefined : "is-planned"}>
                  <Link href={`/docs/${page.slug}`}>{page.title}</Link>
                  {!page.body && <span className="doc-planned">Planned</span>}
                  <p>{page.summary}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}
