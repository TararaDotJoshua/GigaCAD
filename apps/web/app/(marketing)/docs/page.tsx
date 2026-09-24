import type { Metadata } from "next";
import Link from "next/link";
import { docs } from "./content";

export const metadata: Metadata = {
  title: "Docs",
  description: "Learn how to version SolidWorks projects with GigaCAD.",
};

const start = [
  { slug: "install-windows", title: "Install on Windows", body: "Set up the drive and the SolidWorks add-in." },
  { slug: "concepts", title: "Learn the concepts", body: "Branches, versions, and releases in five minutes." },
  { slug: "first-project", title: "Make your first release", body: "Bring in an existing assembly and release v1." },
];

export default function DocsHome() {
  return (
    <article className="doc">
      <h1 className="page-title">GigaCAD docs</h1>
      <p className="lead doc-lead">
        How to install GigaCAD, work on branches, and release SolidWorks projects with your team.
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

      <div className="doc-index">
        {docs.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            <ul>
              {section.pages.map((page) => (
                <li key={page.slug}>
                  <Link href={`/docs/${page.slug}`}>{page.title}</Link>
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
