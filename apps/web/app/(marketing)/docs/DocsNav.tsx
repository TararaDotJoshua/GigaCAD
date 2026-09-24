"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { docs } from "./content";

export function DocsNav() {
  const pathname = usePathname();

  const links = (
    <>
      <Link href="/docs" className="docs-nav-home" aria-current={pathname === "/docs" ? "page" : undefined}>
        Overview
      </Link>
      {docs.map((section) => (
        <div key={section.title} className="docs-nav-section">
          <p className="docs-nav-title">{section.title}</p>
          <ul>
            {section.pages.map((page) => {
              const href = `/docs/${page.slug}`;
              return (
                <li key={page.slug}>
                  <Link href={href} aria-current={pathname === href ? "page" : undefined}>
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );

  return (
    <nav className="docs-nav" aria-label="Docs">
      <details className="docs-nav-mobile">
        <summary>Browse the docs</summary>
        {links}
      </details>
      <div className="docs-nav-desktop">{links}</div>
    </nav>
  );
}
