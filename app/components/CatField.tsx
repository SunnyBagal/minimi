'use client';

/**
 * The animated ASCII cat field behind the page. Three <pre> layers (far,
 * middle, near) whose text is replaced per frame; the frames come from the
 * pure functions in catFrames.ts. The two ascii-magic.com pieces in the side
 * gutters are GutterPieces.tsx. The pointer cat is oneko (Oneko.tsx).
 *
 * - Driven by requestAnimationFrame timestamps, drawn at most FPS times a second.
 * - The grid is measured from one monospace probe, again only on resize.
 * - Stops while the tab is hidden.
 * - With prefers-reduced-motion: reduce, one still frame and no animation.
 */
import { useEffect, useRef } from 'react';
import { createField, renderLayers } from './catFrames';
import { GutterPieces } from './GutterPieces';

const FPS = 12;
const FRAME_MS = 1000 / FPS;
const PROBE = 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM';
/** The still frame drawn under reduced motion. */
const STILL_MS = 0;

export function CatField() {
  const probeRef = useRef<HTMLSpanElement>(null);
  const farRef = useRef<HTMLPreElement>(null);
  const midRef = useRef<HTMLPreElement>(null);
  const nearRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const probe = probeRef.current;
    const layers = [farRef.current, midRef.current, nearRef.current];
    if (probe === null || layers.some((layer) => layer === null)) return;
    const pres = layers as HTMLPreElement[];

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
    const state = createField(seed);
    let cols = 0;
    let rows = 0;
    let raf = 0;
    let lastDraw = -Infinity;
    const shown = ['', '', ''];

    function measure() {
      const box = (probe as HTMLSpanElement).getBoundingClientRect();
      const cellWidth = box.width > 0 ? box.width / PROBE.length : 8;
      const cellHeight = box.height > 0 ? box.height : 16;
      cols = Math.ceil(window.innerWidth / cellWidth);
      rows = Math.ceil(window.innerHeight / cellHeight);
    }

    function draw(tMs: number) {
      renderLayers(cols, rows, tMs, state).forEach((grid, index) => {
        const text = grid.join('\n');
        if (text !== shown[index]) {
          shown[index] = text;
          (pres[index] as HTMLPreElement).textContent = text;
        }
      });
    }

    function frame(tMs: number) {
      raf = window.requestAnimationFrame(frame);
      if (tMs - lastDraw < FRAME_MS) return;
      lastDraw = tMs;
      draw(tMs);
    }

    function stop() {
      if (raf !== 0) window.cancelAnimationFrame(raf);
      raf = 0;
    }

    function start() {
      stop();
      if (reduced.matches) {
        draw(STILL_MS);
        return;
      }
      if (!document.hidden) raf = window.requestAnimationFrame(frame);
    }

    const onResize = () => {
      measure();
      if (reduced.matches) draw(STILL_MS);
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    measure();
    start();
    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    reduced.addEventListener('change', start);
    return () => {
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', start);
    };
  }, []);

  return (
    <div className="catfield" aria-hidden="true">
      <span ref={probeRef} className="catfield-probe">
        {PROBE}
      </span>
      <pre ref={farRef} className="catfield-layer catfield-far" />
      <pre ref={midRef} className="catfield-layer catfield-mid" />
      <pre ref={nearRef} className="catfield-layer catfield-near" />
      <GutterPieces />
    </div>
  );
}
