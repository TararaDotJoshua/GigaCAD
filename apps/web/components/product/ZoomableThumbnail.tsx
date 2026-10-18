'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

/** How long the pointer rests on a thumbnail before it's shown larger. */
const HOVER_DELAY_MS = 500;
const ZOOM_SIZE = 320;
const GAP = 12;
const MARGIN = 8;
/** Image links expire after an hour; a page left open longer refreshes them, at most this often. */
const RELINK_MS = 60_000;
let relinkedAt = 0;

/**
 * A thumbnail that shows a larger copy beside itself after the pointer rests on it for
 * half a second, when it has keyboard focus, or when it's tapped. The copy is fixed-position,
 * so table and card edges don't clip it.
 */
export function ZoomableThumbnail({
  src,
  size,
  label,
  standalone = true,
}: {
  src: string;
  size: number;
  label: string;
  /** False inside a link, which the tap and keyboard focus belong to; then only hover zooms. */
  standalone?: boolean;
}) {
  const router = useRouter();
  const anchor = useRef<HTMLImageElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const [broken, setBroken] = useState(false);

  const close = () => {
    clearTimeout(timer.current);
    setPosition(null);
  };

  useEffect(() => {
    if (!position) return;
    // Fixed-position content would drift from its thumbnail on scroll, so it closes instead.
    const outside = (event: Event) => {
      if (event.target !== anchor.current) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('scroll', close, { capture: true, passive: true });
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [position]);

  useEffect(() => () => clearTimeout(timer.current), []);
  // A new link (after a refresh) gets another chance.
  useEffect(() => setBroken(false), [src]);

  const open = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const zoom = Math.min(ZOOM_SIZE, window.innerWidth - 2 * MARGIN, window.innerHeight - 2 * MARGIN);
    // Beside the thumbnail: to the right if it fits, else to the left; vertically centered on it.
    const fitsRight = rect.right + GAP + zoom <= window.innerWidth - MARGIN;
    const left = fitsRight ? rect.right + GAP : Math.max(MARGIN, rect.left - GAP - zoom);
    const top = Math.min(Math.max(MARGIN, rect.top + rect.height / 2 - zoom / 2), window.innerHeight - MARGIN - zoom);
    setPosition({ left, top, width: zoom, height: zoom });
  };

  return (
    <>
      <img
        ref={anchor}
        src={src}
        alt={standalone ? label : ''}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        tabIndex={standalone ? 0 : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === 'touch') return;
          clearTimeout(timer.current);
          timer.current = setTimeout(open, HOVER_DELAY_MS);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') close();
        }}
        // Touch has no hover: a tap shows it larger, and another tap anywhere puts it away.
        onPointerUp={(event) => {
          if (event.pointerType !== 'touch' || !standalone) return;
          if (position) close();
          else open();
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) open();
        }}
        onBlur={close}
        onError={() => {
          // Most likely an expired link: get the page's links again, once in a while.
          if (broken) return;
          setBroken(true);
          if (Date.now() - relinkedAt > RELINK_MS) {
            relinkedAt = Date.now();
            router.refresh();
          }
        }}
      />
      {position && !broken && (
        <span className="thumbnail-zoom" style={position} aria-hidden="true">
          <img src={src} alt="" width={ZOOM_SIZE} height={ZOOM_SIZE} />
        </span>
      )}
    </>
  );
}
