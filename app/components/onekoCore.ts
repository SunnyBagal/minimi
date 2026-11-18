/**
 * oneko: the cat that chases the pointer. A port of oneko.js,
 * https://github.com/adryd325/oneko.js (oneko.js at main, fetched 2026-11-18),
 * split into this pure step function and the Oneko.tsx component that draws it.
 * The sprite sheet is the original oneko.gif, in public/oneko/ with its LICENSE.
 *
 * Kept as in the original: the sprite sets and their sheet offsets, the 32 px
 * cell, the speed (10 px per frame), one frame per 100 ms, the 48 px stop
 * distance, the alert-then-run countdown, the idle animations (sleeping after
 * "tired", scratching itself, scratching a wall when at an edge) and the 1 in 200
 * chance per idle frame of starting one.
 * Changed for this page: the state is a value passed in and returned (so it can
 * be tested), the random source and viewport are parameters, and the element's
 * z-index and reduced-motion handling live in Oneko.tsx.
 *
 * MIT License
 *
 * Copyright © 2022 adryd
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the “Software”), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

export const NEKO_SPEED = 10;
export const NEKO_FRAME_MS = 100;
export const NEKO_SIZE = 32;

export const SPRITE_SETS = {
  idle: [[-3, -3]],
  alert: [[-7, -3]],
  scratchSelf: [
    [-5, 0],
    [-6, 0],
    [-7, 0],
  ],
  scratchWallN: [
    [0, 0],
    [0, -1],
  ],
  scratchWallS: [
    [-7, -1],
    [-6, -2],
  ],
  scratchWallE: [
    [-2, -2],
    [-2, -3],
  ],
  scratchWallW: [
    [-4, 0],
    [-4, -1],
  ],
  tired: [[-3, -2]],
  sleeping: [
    [-2, 0],
    [-2, -1],
  ],
  N: [
    [-1, -2],
    [-1, -3],
  ],
  NE: [
    [0, -2],
    [0, -3],
  ],
  E: [
    [-3, 0],
    [-3, -1],
  ],
  SE: [
    [-5, -1],
    [-5, -2],
  ],
  S: [
    [-6, -3],
    [-7, -2],
  ],
  SW: [
    [-5, -3],
    [-6, -1],
  ],
  W: [
    [-4, -2],
    [-4, -3],
  ],
  NW: [
    [-1, 0],
    [-1, -1],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;

export type SpriteName = keyof typeof SPRITE_SETS;
type IdleAnimation = 'sleeping' | 'scratchSelf' | 'scratchWallN' | 'scratchWallS' | 'scratchWallE' | 'scratchWallW';

export interface NekoState {
  nekoPosX: number;
  nekoPosY: number;
  frameCount: number;
  idleTime: number;
  idleAnimation: IdleAnimation | null;
  idleAnimationFrame: number;
  /** The background-position of the sprite sheet, e.g. "-96px -96px". */
  bgPos: string;
}

export interface NekoInput {
  mousePosX: number;
  mousePosY: number;
  innerWidth: number;
  innerHeight: number;
  /** A number in [0, 1), like Math.random(). */
  random: () => number;
}

/** The original's starting state: at (32, 32), facing idle. */
export function initialNeko(): NekoState {
  return {
    nekoPosX: 32,
    nekoPosY: 32,
    frameCount: 0,
    idleTime: 0,
    idleAnimation: null,
    idleAnimationFrame: 0,
    bgPos: spritePosition('idle', 0),
  };
}

/** setSprite: the sheet offset for frame `frame` of the named set. */
export function spritePosition(name: SpriteName, frame: number): string {
  const set = SPRITE_SETS[name];
  const sprite = set[frame % set.length] as readonly [number, number];
  return `${sprite[0] * NEKO_SIZE}px ${sprite[1] * NEKO_SIZE}px`;
}

function idle(state: NekoState, input: NekoInput): NekoState {
  const next = { ...state, idleTime: state.idleTime + 1 };

  // every ~ 20 seconds
  if (next.idleTime > 10 && Math.floor(input.random() * 200) === 0 && next.idleAnimation === null) {
    const available: IdleAnimation[] = ['sleeping', 'scratchSelf'];
    if (next.nekoPosX < 32) available.push('scratchWallW');
    if (next.nekoPosY < 32) available.push('scratchWallN');
    if (next.nekoPosX > input.innerWidth - 32) available.push('scratchWallE');
    if (next.nekoPosY > input.innerHeight - 32) available.push('scratchWallS');
    next.idleAnimation = available[Math.floor(input.random() * available.length)] ?? null;
  }

  switch (next.idleAnimation) {
    case 'sleeping':
      if (next.idleAnimationFrame < 8) {
        next.bgPos = spritePosition('tired', 0);
        break;
      }
      next.bgPos = spritePosition('sleeping', Math.floor(next.idleAnimationFrame / 4));
      if (next.idleAnimationFrame > 192) {
        next.idleAnimation = null;
        next.idleAnimationFrame = 0;
      }
      break;
    case 'scratchWallN':
    case 'scratchWallS':
    case 'scratchWallE':
    case 'scratchWallW':
    case 'scratchSelf':
      next.bgPos = spritePosition(next.idleAnimation, next.idleAnimationFrame);
      if (next.idleAnimationFrame > 9) {
        next.idleAnimation = null;
        next.idleAnimationFrame = 0;
      }
      break;
    default:
      next.bgPos = spritePosition('idle', 0);
      return next;
  }
  next.idleAnimationFrame += 1;
  return next;
}

/** One 100 ms frame of the original's frame(). */
export function nekoFrame(state: NekoState, input: NekoInput): NekoState {
  const next = { ...state, frameCount: state.frameCount + 1 };
  const diffX = next.nekoPosX - input.mousePosX;
  const diffY = next.nekoPosY - input.mousePosY;
  const distance = Math.sqrt(diffX ** 2 + diffY ** 2);

  if (distance < NEKO_SPEED || distance < 48) return idle(next, input);

  next.idleAnimation = null;
  next.idleAnimationFrame = 0;

  if (next.idleTime > 1) {
    next.bgPos = spritePosition('alert', 0);
    // count down after being alerted before moving
    next.idleTime = Math.min(next.idleTime, 7);
    next.idleTime -= 1;
    return next;
  }

  let direction = diffY / distance > 0.5 ? 'N' : '';
  direction += diffY / distance < -0.5 ? 'S' : '';
  direction += diffX / distance > 0.5 ? 'W' : '';
  direction += diffX / distance < -0.5 ? 'E' : '';
  next.bgPos = spritePosition(direction as SpriteName, next.frameCount);

  next.nekoPosX -= (diffX / distance) * NEKO_SPEED;
  next.nekoPosY -= (diffY / distance) * NEKO_SPEED;

  next.nekoPosX = Math.min(Math.max(16, next.nekoPosX), input.innerWidth - 16);
  next.nekoPosY = Math.min(Math.max(16, next.nekoPosY), input.innerHeight - 16);
  return next;
}

/** The original persists its state under this key on unload and restores it on load. */
export const NEKO_STORAGE_KEY = 'oneko';

/** Restores a saved state, or null when there is none or it does not parse. */
export function restoreNeko(saved: string | null): NekoState | null {
  if (saved === null) return null;
  try {
    const value: unknown = JSON.parse(saved);
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    const numbers = ['nekoPosX', 'nekoPosY', 'frameCount', 'idleTime', 'idleAnimationFrame'] as const;
    if (!numbers.every((key) => typeof v[key] === 'number' && Number.isFinite(v[key]))) return null;
    const idleNames: (IdleAnimation | null)[] = [null, 'sleeping', 'scratchSelf', 'scratchWallN', 'scratchWallS', 'scratchWallE', 'scratchWallW'];
    const idleAnimation = idleNames.includes(v.idleAnimation as IdleAnimation | null) ? (v.idleAnimation as IdleAnimation | null) : null;
    return {
      nekoPosX: v.nekoPosX as number,
      nekoPosY: v.nekoPosY as number,
      frameCount: v.frameCount as number,
      idleTime: v.idleTime as number,
      idleAnimation,
      idleAnimationFrame: v.idleAnimationFrame as number,
      bgPos: typeof v.bgPos === 'string' && /^-?\d+px -?\d+px$/.test(v.bgPos) ? v.bgPos : spritePosition('idle', 0),
    };
  } catch {
    return null;
  }
}
