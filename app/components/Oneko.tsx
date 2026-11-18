'use client';

/**
 * The oneko cat (port of https://github.com/adryd325/oneko.js, MIT, Copyright ©
 * 2022 adryd; the licence is in onekoCore.ts and public/oneko/LICENSE). The logic is
 * onekoCore.ts; this draws it on one fixed 32 px element with the original sprite
 * sheet, one frame per 100 ms, following `mousemove` as the original does.
 *
 * Differences from the original script, all about fitting this page:
 * - Rendered once by React inside the app layer, so it sits above the cat field
 *   and below the header and composer (z-index in globals.css), and unmounting
 *   stops its timer and listeners. New chat and the theme toggle do not remount it.
 * - prefers-reduced-motion: reduce shows no cat, as the original; turning it on
 *   later hides the cat too.
 * - localStorage reads and writes are wrapped in try/catch.
 */
import { useEffect, useRef } from 'react';
import { initialNeko, NEKO_FRAME_MS, NEKO_STORAGE_KEY, nekoFrame, restoreNeko, type NekoState } from './onekoCore';

export function Oneko() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    let state: NekoState = initialNeko();
    let mousePosX = 0;
    let mousePosY = 0;
    try {
      const saved = window.localStorage.getItem(NEKO_STORAGE_KEY);
      const restored = restoreNeko(saved);
      if (restored !== null) {
        state = restored;
        const raw = JSON.parse(saved as string) as { mousePosX?: unknown; mousePosY?: unknown };
        if (typeof raw.mousePosX === 'number') mousePosX = raw.mousePosX;
        if (typeof raw.mousePosY === 'number') mousePosY = raw.mousePosY;
      }
    } catch {
      // No saved position; start at the original's corner.
    }

    const draw = () => {
      el.style.left = `${state.nekoPosX - 16}px`;
      el.style.top = `${state.nekoPosY - 16}px`;
      el.style.backgroundPosition = state.bgPos;
    };

    const onMouse = (event: MouseEvent) => {
      mousePosX = event.clientX;
      mousePosY = event.clientY;
    };
    const save = () => {
      try {
        window.localStorage.setItem(NEKO_STORAGE_KEY, JSON.stringify({ ...state, mousePosX, mousePosY }));
      } catch {
        // Storage refused; the cat starts in the corner next time.
      }
    };

    let interval = 0;
    const start = () => {
      window.clearInterval(interval);
      interval = 0;
      if (reduced.matches) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      draw();
      interval = window.setInterval(() => {
        state = nekoFrame(state, {
          mousePosX,
          mousePosY,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          random: Math.random,
        });
        draw();
      }, NEKO_FRAME_MS);
    };

    start();
    document.addEventListener('mousemove', onMouse);
    window.addEventListener('beforeunload', save);
    reduced.addEventListener('change', start);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('mousemove', onMouse);
      window.removeEventListener('beforeunload', save);
      reduced.removeEventListener('change', start);
      save();
    };
  }, []);

  return <div ref={ref} id="oneko" className="oneko" aria-hidden="true" hidden />;
}
