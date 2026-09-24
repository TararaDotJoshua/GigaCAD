/** The G mark: the bowl of a G whose crossbar turns into an arrow. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M18.2 6.1A8.5 8.5 0 1 0 12.4 20.5"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="butt"
      />
      <path
        d="M13.6 11.4h7.2v7.2M20.3 11.9l-6.6 6.6"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark className="logo-mark" />
      <span className="logo-word">GigaCAD</span>
    </span>
  );
}
