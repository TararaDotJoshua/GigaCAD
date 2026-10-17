"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccountLink } from "./AccountLinks";
import { MenuIcon } from "./icons";

const links = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/newsroom", label: "Newsroom" },
];

/** `page` on the section's own page, `true` on pages inside it, like an article in the newsroom. */
function currentFor(pathname: string, href: string) {
  if (href.includes("#")) return undefined;
  if (pathname === href) return "page";
  return pathname.startsWith(`${href}/`) ? "true" : undefined;
}

function Links({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return links.map(({ href, label }) => (
    <Link key={href} href={href} aria-current={currentFor(pathname, href)} onClick={onNavigate}>
      {label}
    </Link>
  ));
}

/** The header's page links. Wide screens show them inline. */
export function SiteNav() {
  return (
    <nav className="nav-links" aria-label="Main">
      <Links />
    </nav>
  );
}

/**
 * The same links on narrow screens, behind a Menu button. Log in moves in here too, so
 * the bar fits a phone. It closes on a link, Escape, a click or focus outside, or a new page.
 */
export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={root}
      className="nav-menu"
      onBlur={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className="nav-menu-button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <MenuIcon className="icon" />
      </button>
      <nav id="site-menu" className="nav-menu-panel" aria-label="Main" hidden={!open}>
        <Links onNavigate={() => setOpen(false)} />
        <AccountLink className="nav-menu-login" />
      </nav>
    </div>
  );
}
