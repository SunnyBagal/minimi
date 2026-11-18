'use client';

/**
 * The oneko cat: the `useNeko` hook from the site owner's portfolio, ported to React and
 * TypeScript. The logic is onekoCore.ts; this draws it on one fixed 32 px element with
 * the oneko.gif sprite sheet served from public/oneko/, one tick per 100 ms, and owns
 * the pointer listener, the click that cycles the mode, and the wander sit timer.
 * Credits are in CREDITS.md.
 *
 * Fitted to this page:
 * - Always on (the portfolio summons it with a button); rendered once in the page, so
 *   New chat and the theme toggle do not remount it. Unmounting stops every timer and
 *   listener.
 * - Layering (globals.css): z-index 1 inside the app, so it walks over the card and
 *   bubble backgrounds but under their text, and under the header and composer.
 * - Only the 32 px sprite takes pointer events (for the click); nothing else changes.
 *   Where it walks under an answer's text layer, a click on its visible pixels in blank
 *   space still reaches it; text, links and controls keep their clicks (catClick.ts).
 * - prefers-reduced-motion: reduce shows no cat; turning it on later hides it too.
 */
import { useEffect, useRef } from 'react';
import { catTakesClick, CLICKABLE, inRect, onGlyph } from './catClick';
import {
  changeMode,
  endSit,
  initialNeko,
  NEKO_FRAME_MS,
  NEKO_SIZE,
  NEKO_WANDER_SELECTORS,
  nekoFrame,
  nextMode,
  pickWanderTarget,
  sitMs,
  type NekoMode,
  type NekoState,
} from './onekoCore';

export function Oneko() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const randTarget = () =>
      pickWanderTarget(
        Array.from(document.querySelectorAll(NEKO_WANDER_SELECTORS), (node) => node.getBoundingClientRect()),
        window.innerWidth,
        window.innerHeight,
        Math.random,
      );

    let mode: NekoMode = 0;
    let state: NekoState = initialNeko(window.innerWidth, window.innerHeight, randTarget());
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let interval = 0;
    let sitTimer = 0;

    const draw = () => {
      el.style.left = `${state.x - NEKO_SIZE / 2}px`;
      el.style.top = `${state.y - NEKO_SIZE / 2}px`;
      el.style.backgroundPosition = state.bgPos;
    };

    const tick = () => {
      const wasSitting = state.sitting;
      state = nekoFrame(state, { mode, mouseX, mouseY, innerWidth: window.innerWidth, innerHeight: window.innerHeight });
      draw();
      if (!wasSitting && state.sitting) {
        sitTimer = window.setTimeout(() => {
          state = endSit(state, randTarget());
        }, sitMs(Math.random));
      }
    };

    const start = () => {
      window.clearInterval(interval);
      window.clearTimeout(sitTimer);
      interval = 0;
      if (reduced.matches) {
        el.hidden = true;
        return;
      }
      // A sit whose timer was cleared above would never end; stand the cat up.
      if (state.sitting) state = endSit(state, randTarget());
      el.hidden = false;
      draw();
      interval = window.setInterval(tick, NEKO_FRAME_MS);
    };

    const onMouse = (event: MouseEvent) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
    };
    const cycleMode = () => {
      mode = nextMode(mode);
      window.clearTimeout(sitTimer);
      state = changeMode(state, mode, randTarget());
    };
    const onClick = (event: MouseEvent) => {
      event.stopPropagation();
      cycleMode();
    };
    // A click on the visible sprite where it walks under an answer's blank space (catClick.ts).
    const onPageClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented || event.target === el) return;
      const target = event.target instanceof Element ? event.target : null;
      const selection = window.getSelection();
      const facts = {
        spriteShown: !el.hidden,
        insideSprite: inRect(event.clientX, event.clientY, el.getBoundingClientRect()),
        inConversation: target?.closest('.thread') != null,
        onControl: target?.closest(CLICKABLE) != null,
        selecting: selection !== null && !selection.isCollapsed,
        onGlyph: false,
      };
      if (!catTakesClick(facts)) return;
      if (onGlyph(document, event.clientX, event.clientY)) return;
      cycleMode();
    };

    start();
    window.addEventListener('mousemove', onMouse);
    el.addEventListener('click', onClick);
    document.addEventListener('click', onPageClick);
    reduced.addEventListener('change', start);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(sitTimer);
      window.removeEventListener('mousemove', onMouse);
      el.removeEventListener('click', onClick);
      document.removeEventListener('click', onPageClick);
      reduced.removeEventListener('change', start);
    };
  }, []);

  return <div ref={ref} id="oneko" className="oneko" aria-hidden="true" hidden />;
}
