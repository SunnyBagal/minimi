'use client';

/**
 * Two animated pieces from the ASCII Magic library (MIT; see
 * asciiMagicPieces.ts and CREDITS.md), one in each bottom side gutter. Shown
 * only where the gutters are wide enough (see .gutter-piece in globals.css),
 * so they never sit under the column; the frames load only then.
 *
 * Driven by requestAnimationFrame timestamps at the piece's own speed, stopped
 * while the tab is hidden; with prefers-reduced-motion: reduce, one still frame.
 */
import { useEffect, useRef } from 'react';
import { decodeFrame, frameIndexAt, type AsciiPiece } from './pieceFrames';

/** Matches the CSS rule that shows the pieces. */
const WIDE_ENOUGH = '(min-width: 1240px) and (min-height: 640px)';

export function GutterPieces() {
  const leftRef = useRef<HTMLPreElement>(null);
  const rightRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (left === null || right === null) return;
    const wide = window.matchMedia(WIDE_ENOUGH);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let pieces: [AsciiPiece, HTMLPreElement][] | null = null;
    let loading = false;
    let raf = 0;
    let disposed = false;
    const shown = new Map<HTMLPreElement, number>();

    const draw = (tMs: number) => {
      for (const [piece, el] of pieces ?? []) {
        const index = frameIndexAt(piece, tMs);
        if (shown.get(el) === index) continue;
        shown.set(el, index);
        el.textContent = decodeFrame(piece, index);
      }
    };
    const frame = (tMs: number) => {
      raf = window.requestAnimationFrame(frame);
      draw(tMs);
    };
    const stop = () => {
      if (raf !== 0) window.cancelAnimationFrame(raf);
      raf = 0;
    };
    const start = () => {
      stop();
      if (pieces === null || !wide.matches) return;
      if (reduced.matches) {
        draw(0);
        return;
      }
      if (!document.hidden) raf = window.requestAnimationFrame(frame);
    };
    const ensureLoaded = () => {
      if (!wide.matches || pieces !== null || loading) {
        start();
        return;
      }
      loading = true;
      void import('./asciiMagicPieces').then(({ SLEEPING_CAT, CAT_AT_THE_KEYBOARD }) => {
        if (disposed) return;
        left.style.setProperty('--cols', String(SLEEPING_CAT.cols));
        right.style.setProperty('--cols', String(CAT_AT_THE_KEYBOARD.cols));
        pieces = [
          [SLEEPING_CAT, left],
          [CAT_AT_THE_KEYBOARD, right],
        ];
        start();
      });
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    ensureLoaded();
    wide.addEventListener('change', ensureLoaded);
    reduced.addEventListener('change', start);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      stop();
      wide.removeEventListener('change', ensureLoaded);
      reduced.removeEventListener('change', start);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <>
      <pre ref={leftRef} className="gutter-piece gutter-piece-left" />
      <pre ref={rightRef} className="gutter-piece gutter-piece-right" />
    </>
  );
}
