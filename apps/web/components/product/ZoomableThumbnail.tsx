'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

/** How long the pointer rests on a thumbnail before it's shown larger. */
const HOVER_DELAY_MS = 500;
const ZOOM_SIZE = 320;
const GAP = 12;
const MARGIN = 8;

/**
 * A thumbnail that shows a larger copy beside itself after the pointer rests on it for
 * half a second. The copy is fixed-position, so table and card edges don't clip it.
 * Touch has no hover, so it's mouse and pen only.
 */
export function ZoomableThumbnail({ src, size }: { src: string; size: number }) {
  const anchor = useRef<HTMLImageElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [position, setPosition] = useState<CSSProperties | null>(null);

  const close = () => {
    clearTimeout(timer.current);
    setPosition(null);
  };

  useEffect(() => {
    if (!position) return;
    // Fixed-position content would drift from its thumbnail on scroll, so it closes instead.
    window.addEventListener('scroll', close, { capture: true, passive: true });
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
    };
  }, [position]);

  useEffect(() => () => clearTimeout(timer.current), []);

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
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onPointerEnter={(event) => {
          if (event.pointerType === 'touch') return;
          clearTimeout(timer.current);
          timer.current = setTimeout(open, HOVER_DELAY_MS);
        }}
        onPointerLeave={close}
      />
      {position && (
        <span className="thumbnail-zoom" style={position} aria-hidden="true">
          <img src={src} alt="" width={ZOOM_SIZE} height={ZOOM_SIZE} />
        </span>
      )}
    </>
  );
}
