/**
 * oneko: the cat that chases the pointer. The behaviour is the `useNeko` hook from
 * the site owner's portfolio (`src/components/sections/hero.js`, follow mode), ported
 * to TypeScript as a pure step function; Oneko.tsx draws it. The sprite sheet is
 * oneko.gif from https://github.com/adryd325/oneko.js (MIT, Copyright © 2022 adryd),
 * served from public/oneko/ with its LICENSE; the sheet offsets below are that
 * project's, as the portfolio uses them.
 *
 * Kept as in the portfolio: the sprite sets, the 32 px cell, the speed (10 px per
 * tick, never past the target), one tick per 100 ms, the 48 px stop distance, the
 * eight-way direction from the angle, and the phases: running, then idle; after 10
 * idle ticks tired; after 15 tired ticks sleeping; woken from tired or sleeping it is
 * alerted for one tick before it runs again.
 * Changed for this page: the state is a value passed in and returned (so it can be
 * tested), the viewport is a parameter, and the target is not always the pointer:
 * Oneko.tsx passes a point outside the conversation column (nekoColumn.ts). The
 * portfolio's flee and wander modes are switched by clicking the cat; this cat takes
 * no pointer events, so only follow mode is ported.
 */

export const NEKO_SPEED = 10;
export const NEKO_FRAME_MS = 100;
export const NEKO_SIZE = 32;
/** Within this distance of its target the cat stops and idles. */
export const NEKO_NEAR_PX = 48;
/** Idle ticks before it gets tired. */
export const NEKO_IDLE_TICKS = 10;
/** Tired ticks before it falls asleep. */
export const NEKO_TIRED_TICKS = 15;
/** arriveWithin for a target on the column's edge: the cat steps exactly onto it. */
export const NEKO_EDGE_ARRIVE_PX = 1;
/** Ticks an alerted cat that is already at its target waits before idling again. */
export const NEKO_ALERT_TICKS = 3;

export const SPRITE_SETS = {
  idle: [[-3, -3]],
  alert: [[-7, -3]],
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
export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export type NekoPhase = 'running' | 'idle' | 'tired' | 'sleeping' | 'alert';

export interface NekoState {
  /** The cat's centre, in viewport pixels. */
  x: number;
  y: number;
  frame: number;
  tickCount: number;
  phase: NekoPhase;
  /** The background-position of the sprite sheet, e.g. "-96px -96px". */
  bgPos: string;
}

export interface NekoInput {
  /** Where the cat runs to: the pointer, or the nearest point outside the column. */
  targetX: number;
  targetY: number;
  innerWidth: number;
  innerHeight: number;
  /**
   * How close a running cat gets before it stops. Defaults to NEKO_NEAR_PX, as in the
   * portfolio. Oneko.tsx passes a smaller value when the target is the column's edge, so
   * the cat waits at the edge rather than 48 px short of it. A resting cat still only
   * wakes when the target is NEKO_NEAR_PX or more away.
   */
  arriveWithin?: number;
}

/** The portfolio's starting state: in the middle of the viewport, idle. */
export function initialNeko(innerWidth: number, innerHeight: number): NekoState {
  return {
    x: innerWidth / 2,
    y: innerHeight / 2,
    frame: 0,
    tickCount: 0,
    phase: 'idle',
    bgPos: spritePosition('idle', 0),
  };
}

/** setSprite: the sheet offset for frame `frame` of the named set. */
export function spritePosition(name: SpriteName, frame: number): string {
  const set = SPRITE_SETS[name];
  const sprite = set[frame % set.length] as readonly [number, number];
  return `${sprite[0] * NEKO_SIZE}px ${sprite[1] * NEKO_SIZE}px`;
}

/** angleToDir: the direction for an angle in degrees (0 = east, 90 = south, screen axes). */
export function angleToDir(angle: number): Direction {
  if (angle > -22.5 && angle <= 22.5) return 'E';
  if (angle > 22.5 && angle <= 67.5) return 'SE';
  if (angle > 67.5 && angle <= 112.5) return 'S';
  if (angle > 112.5 && angle <= 157.5) return 'SW';
  if (angle > -67.5 && angle <= -22.5) return 'NE';
  if (angle > -112.5 && angle <= -67.5) return 'N';
  if (angle > -157.5 && angle <= -112.5) return 'NW';
  return 'W';
}

/** One 100 ms tick of the portfolio's follow mode. */
export function nekoFrame(state: NekoState, input: NekoInput): NekoState {
  const s: NekoState = { ...state, frame: state.frame + 1, tickCount: state.tickCount + 1 };
  const dx = input.targetX - s.x;
  const dy = input.targetY - s.y;
  const dist = Math.hypot(dx, dy);
  const near = s.phase === 'running' ? (input.arriveWithin ?? NEKO_NEAR_PX) : NEKO_NEAR_PX;

  if (dist < near) {
    if (s.phase === 'running') {
      s.phase = 'idle';
      s.tickCount = 0;
    }
    if (s.phase === 'idle') {
      if (s.tickCount > NEKO_IDLE_TICKS) {
        s.phase = 'tired';
        s.tickCount = 0;
      } else {
        s.bgPos = spritePosition('idle', 0);
      }
    } else if (s.phase === 'tired') {
      s.bgPos = spritePosition('tired', 0);
      if (s.tickCount > NEKO_TIRED_TICKS) {
        s.phase = 'sleeping';
        s.tickCount = 0;
      }
    } else if (s.phase === 'sleeping') {
      s.bgPos = spritePosition('sleeping', s.frame);
    } else if (s.phase === 'alert') {
      s.bgPos = spritePosition('alert', 0);
      if (s.tickCount > NEKO_ALERT_TICKS) {
        s.phase = 'idle';
        s.tickCount = 0;
      }
    }
    return s;
  }

  if (s.phase === 'sleeping' || s.phase === 'tired') {
    s.phase = 'alert';
    s.tickCount = 0;
    s.bgPos = spritePosition('alert', 0);
    return s;
  }

  s.phase = 'running';
  const step = Math.min(NEKO_SPEED, dist);
  s.x = Math.max(NEKO_SIZE / 2, Math.min(input.innerWidth - NEKO_SIZE / 2, s.x + (dx / dist) * step));
  s.y = Math.max(NEKO_SIZE / 2, Math.min(input.innerHeight - NEKO_SIZE / 2, s.y + (dy / dist) * step));
  s.bgPos = spritePosition(angleToDir(Math.atan2(dy, dx) * (180 / Math.PI)), s.frame);
  return s;
}
