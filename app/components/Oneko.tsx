'use client';

/**
 * The oneko cat: the `useNeko` hook from the site owner's portfolio (follow mode),
 * ported to React and TypeScript. The logic is onekoCore.ts and nekoColumn.ts; this
 * draws it on one fixed 32 px element with the oneko.gif sprite sheet served from
 * public/oneko/, one tick per 100 ms. Credits are in CREDITS.md.
 *
 * Fitted to this page:
 * - The cat stays off the conversation column (the thread and the composer). When the
 *   pointer is over the column it runs to the nearest point on the column's edge and
 *   waits there; it never crosses the column. The column is measured again on resize,
 *   scroll and when the thread or composer changes size.
 * - Where neither side of the column has room for the cat (a phone), there is no cat.
 * - prefers-reduced-motion: reduce shows no cat; turning it on later hides it too.
 * - pointer-events: none (globals.css), so it never takes a click. Rendered once in
 *   the page, so New chat and the theme toggle do not remount it.
 */
import { useEffect, useRef } from 'react';
import { columnBand, insideRect, keepOut, nekoTarget, placeOutside, type Point, type Rect } from './nekoColumn';
import { initialNeko, NEKO_EDGE_ARRIVE_PX, NEKO_FRAME_MS, NEKO_SIZE, nekoFrame, type NekoState } from './onekoCore';

/** The elements that make up the conversation column. */
const COLUMN_SELECTORS = ['.thread', '.composer-form'];

export function Oneko() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    let state: NekoState = initialNeko(window.innerWidth, window.innerHeight);
    let pointer: Point = { x: state.x, y: state.y };
    let column: Rect | null = null;

    const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
    const measure = () => {
      const rects = COLUMN_SELECTORS.flatMap((selector) => {
        const node = document.querySelector(selector);
        return node === null ? [] : [node.getBoundingClientRect()];
      });
      column = columnBand(rects, viewport());
    };

    const draw = () => {
      el.style.left = `${state.x - NEKO_SIZE / 2}px`;
      el.style.top = `${state.y - NEKO_SIZE / 2}px`;
      el.style.backgroundPosition = state.bgPos;
    };

    /** One tick. Returns false when there is no room for the cat beside the column. */
    const tick = (): boolean => {
      const view = viewport();
      let target: Point | null = pointer;
      if (column !== null) {
        const cat = { x: state.x, y: state.y };
        if (insideRect(cat, keepOut(column, NEKO_SIZE))) {
          const outside = placeOutside(cat, NEKO_SIZE, column, view);
          if (outside === null) return false;
          state = { ...state, x: outside.x, y: outside.y };
        }
        target = nekoTarget(pointer, { x: state.x, y: state.y }, NEKO_SIZE, column, view);
        if (target === null) return false;
      }
      const atEdge = target.x !== pointer.x || target.y !== pointer.y;
      state = nekoFrame(state, {
        targetX: target.x,
        targetY: target.y,
        innerWidth: view.width,
        innerHeight: view.height,
        arriveWithin: atEdge ? NEKO_EDGE_ARRIVE_PX : undefined,
      });
      return true;
    };

    let interval = 0;
    const step = () => {
      const room = tick();
      el.hidden = !room;
      if (room) draw();
    };
    const start = () => {
      window.clearInterval(interval);
      interval = 0;
      if (reduced.matches) {
        el.hidden = true;
        return;
      }
      measure();
      step();
      interval = window.setInterval(step, NEKO_FRAME_MS);
    };

    const onMouse = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const observer = new ResizeObserver(measure);
    for (const selector of COLUMN_SELECTORS) {
      const node = document.querySelector(selector);
      if (node !== null) observer.observe(node);
    }

    start();
    document.addEventListener('mousemove', onMouse);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { capture: true, passive: true });
    reduced.addEventListener('change', start);
    return () => {
      window.clearInterval(interval);
      observer.disconnect();
      document.removeEventListener('mousemove', onMouse);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, { capture: true });
      reduced.removeEventListener('change', start);
    };
  }, []);

  return <div ref={ref} id="oneko" className="oneko" aria-hidden="true" hidden />;
}
