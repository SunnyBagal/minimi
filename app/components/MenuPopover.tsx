'use client';

/**
 * A macOS menu-bar style popover anchored under a header icon button. Closes on Esc, an
 * outside click, or the button again (the page toggles `open`). Focus moves into the
 * popover when it opens and back to the button when it closes. Rendered outside the
 * header (whose backdrop blur would stop this one's blur from seeing the page) at a fixed
 * position computed from the button. On a phone it is a sheet under the header, full
 * width minus 16 px gutters. The fade and scale are CSS and are off under reduced motion.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

const GUTTER = 16;
const GAP = 8;
const PHONE_MAX = 560;
const WIDTH = 344;
/** Matches the .mb-closing animation in globals.css. */
const CLOSE_MS = 120;

export interface PopoverPlace {
  top: number;
  left: number;
  width: number;
  /** Where the popover grows from, for the scale animation: the button's centre. */
  originX: number;
}

/** Under the button, centred on it, clamped into the window; full width on a phone. */
export function placePopover(anchor: { left: number; right: number; bottom: number }, viewportWidth: number): PopoverPlace {
  const top = anchor.bottom + GAP;
  const centre = (anchor.left + anchor.right) / 2;
  if (viewportWidth <= PHONE_MAX) {
    return { top, left: GUTTER, width: viewportWidth - 2 * GUTTER, originX: centre - GUTTER };
  }
  const width = Math.min(WIDTH, viewportWidth - 2 * GUTTER);
  const left = Math.min(Math.max(centre - width / 2, GUTTER), viewportWidth - GUTTER - width);
  return { top, left, width, originX: centre - left };
}

export function MenuPopover({
  id,
  open,
  anchor,
  labelledBy,
  onClose,
  children,
}: {
  id: string;
  open: boolean;
  anchor: RefObject<HTMLButtonElement | null>;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<PopoverPlace | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const button = anchor.current;
      if (button === null) return;
      setPlace(placePopover(button.getBoundingClientRect(), window.innerWidth));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const button = anchor.current;
    const node = ref.current;
    node?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (node?.contains(target) || button?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      // Back to the button, unless the user has already moved focus somewhere else.
      const active = document.activeElement;
      if (active === null || active === document.body || node?.contains(active)) button?.focus();
    };
  }, [open, anchor, onClose]);

  // Keep the popover on screen for the closing fade, unless motion is reduced.
  const [closing, setClosing] = useState(false);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setClosing(true);
      const timer = window.setTimeout(() => setClosing(false), CLOSE_MS);
      wasOpen.current = open;
      return () => window.clearTimeout(timer);
    }
    wasOpen.current = open;
    setClosing(false);
    return undefined;
  }, [open]);

  if (!open && !closing) return null;
  return (
    <div
      ref={open ? ref : undefined}
      id={id}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelledBy}
      aria-hidden={open ? undefined : true}
      tabIndex={-1}
      className={open ? 'mb-popover' : 'mb-popover mb-closing'}
      style={
        place === null
          ? { visibility: 'hidden' }
          : { top: place.top, left: place.left, width: place.width, transformOrigin: `${place.originX}px 0` }
      }
    >
      {children}
    </div>
  );
}
