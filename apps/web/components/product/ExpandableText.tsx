'use client';

import { useLayoutEffect, useRef, useState } from 'react';

/** Text cut to a few lines, with a More button when there's more of it, like a long project description. */
export function ExpandableText({ children, className }: { children: string; className?: string }) {
  const text = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const node = text.current;
    if (!node || open) return;
    const measure = () => setClipped(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, children]);
  return (
    <span className={`expandable${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <span ref={text} className="expandable-text">
        {children}
      </span>
      {(clipped || open) && (
        <button type="button" className="link-button expandable-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Less' : 'More'}
        </button>
      )}
    </span>
  );
}
