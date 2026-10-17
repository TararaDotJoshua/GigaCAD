"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { docs } from "./content";

export function DocsNav() {
  const pathname = usePathname();
  const mobile = useRef<HTMLDetailsElement>(null);

  // On a phone the menu folds away once a page is chosen.
  useEffect(() => {
    if (mobile.current) mobile.current.open = false;
  }, [pathname]);

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
                <li key={page.slug} className={page.body ? undefined : "is-planned"}>
                  <Link href={href} aria-current={pathname === href ? "page" : undefined}>
                    {page.title}
                    {!page.body && <span className="sr-only"> (planned)</span>}
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
      <a className="skip-link" href="#doc-content">
        Skip the docs menu
      </a>
      <details ref={mobile} className="docs-nav-mobile">
        <summary>Browse the docs</summary>
        {links}
      </details>
      <div className="docs-nav-desktop">{links}</div>
    </nav>
  );
}
