'use client';

/**
 * The animated ASCII cat field behind the page. Three <pre> layers (far,
 * middle, near) whose text is replaced per frame; the frames come from the
 * pure functions in catFrames.ts.
 *
 * - Driven by requestAnimationFrame timestamps, drawn at most FPS times a second.
 * - The grid is measured from one monospace probe, again only on resize.
 * - Stops while the tab is hidden.
 * - With prefers-reduced-motion: reduce, one still frame, no animation, no pointer cat.
 */
import { useEffect, useRef } from 'react';
import { createField, renderLayers, stepNeko, type FieldState } from './catFrames';

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
    let state: FieldState = createField(seed);
    let cols = 0;
    let rows = 0;
    let cellWidth = 8;
    let cellHeight = 16;
    let pointer: { x: number; y: number } | null = null;
    let raf = 0;
    let lastDraw = -Infinity;
    const shown = ['', '', ''];

    function measure() {
      const box = (probe as HTMLSpanElement).getBoundingClientRect();
      if (box.width > 0) cellWidth = box.width / PROBE.length;
      if (box.height > 0) cellHeight = box.height;
      cols = Math.ceil(window.innerWidth / cellWidth);
      rows = Math.ceil(window.innerHeight / cellHeight);
    }

    function draw(tMs: number, current: FieldState) {
      const grids = renderLayers(cols, rows, tMs, current);
      grids.forEach((grid, index) => {
        const text = grid.join('\n');
        if (text !== shown[index]) {
          shown[index] = text;
          (pres[index] as HTMLPreElement).textContent = text;
        }
      });
    }

    function pointerCell(): { col: number; row: number } | null {
      if (pointer === null) return null;
      return { col: Math.floor(pointer.x / cellWidth), row: Math.floor(pointer.y / cellHeight) };
    }

    function frame(tMs: number) {
      raf = window.requestAnimationFrame(frame);
      if (tMs - lastDraw < FRAME_MS) return;
      lastDraw = tMs;
      if (state.neko !== null) state = { ...state, neko: stepNeko(state.neko, pointerCell(), tMs, cols, rows) };
      draw(tMs, state);
    }

    function stop() {
      if (raf !== 0) window.cancelAnimationFrame(raf);
      raf = 0;
    }

    function start() {
      stop();
      if (reduced.matches) {
        draw(STILL_MS, { ...state, neko: null });
        return;
      }
      if (!document.hidden) raf = window.requestAnimationFrame(frame);
    }

    const onResize = () => {
      measure();
      if (reduced.matches) draw(STILL_MS, { ...state, neko: null });
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onPointer = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const onMotion = () => {
      // Back from reduced motion: the pointer cat starts fresh.
      state = createField(seed);
      start();
    };

    measure();
    start();
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    reduced.addEventListener('change', onMotion);
    return () => {
      stop();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', onMotion);
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
    </div>
  );
}
