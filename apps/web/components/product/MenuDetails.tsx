'use client';

/**
 * A `<details className="menu">` whose `.menu-form` popover opens rightward from its button,
 * so it never covers the sidebar, and ends at the button instead when that would leave the screen.
 */
export function MenuDetails({ children }: { children: React.ReactNode }) {
  return (
    <details
      className="menu"
      onToggle={(event) => {
        const details = event.currentTarget;
        const panel = details.querySelector<HTMLElement>('.menu-form');
        if (!details.open || !panel) return;
        const button = details.querySelector('summary')!.getBoundingClientRect();
        panel.classList.toggle('is-end', button.left + panel.offsetWidth > document.documentElement.clientWidth - 16);
      }}
    >
      {children}
    </details>
  );
}
