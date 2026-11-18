/**
 * oneko: the cat on the page. The behaviour is the `useNeko` hook from the site owner's
 * portfolio (`src/components/sections/hero.js`), ported to TypeScript as pure functions;
 * Oneko.tsx draws it and owns the timers and DOM reads. The sprite sheet is oneko.gif
 * from https://github.com/adryd325/oneko.js (MIT, Copyright © 2022 adryd), served from
 * public/oneko/ with its LICENSE; the sheet offsets below are that project's, as the
 * portfolio uses them.
 *
 * As in the portfolio:
 * - Three modes, cycled by clicking the cat: follow → flee → wander → follow.
 * - Follow: run at the pointer (10 px a tick, never past it); within 48 px stop; idle,
 *   after 10 idle ticks tired, after 15 tired ticks sleeping. Woken from tired or
 *   sleeping it is alerted for a tick, then runs. Alerted but already near, it waits
 *   3 ticks and idles.
 * - Flee: within 220 px of the pointer, run away at 1.4 × speed, kept 24 px inside
 *   the window, facing away; further off, idle.
 * - Wander: run to a random visible heading, paragraph, link, button, list item or
 *   icon (or a random point when there is none); within 48 px sit asleep for 2–3 s,
 *   then pick the next target.
 * - One tick per 100 ms; the cat starts in the middle of the window.
 * The only changes are the shape: state is a value passed in and returned, and the
 * random source, window size and target rectangles are parameters, so it can be tested.
 */

export const NEKO_SPEED = 10;
export const NEKO_FRAME_MS = 100;
export const NEKO_SIZE = 32;
/** Follow and wander: within this distance of the target the cat stops. */
export const NEKO_NEAR_PX = 48;
/** Follow: idle ticks before it gets tired. */
export const NEKO_IDLE_TICKS = 10;
/** Follow: tired ticks before it falls asleep. */
export const NEKO_TIRED_TICKS = 15;
/** Follow: ticks an alerted cat that is already near waits before idling. */
export const NEKO_ALERT_TICKS = 3;
/** Flee: the cat runs only while the pointer is closer than this. */
export const NEKO_FLEE_RADIUS = 220;
/** Flee: speed multiplier. */
export const NEKO_FLEE_FACTOR = 1.4;
/** Flee: how far inside the window the cat is kept. */
export const NEKO_FLEE_MARGIN = 24;
/** Follow and wander: how far inside the window the cat's centre is kept. */
export const NEKO_EDGE = 16;
/** Wander: the sit lasts NEKO_SIT_MS plus up to NEKO_SIT_JITTER_MS. */
export const NEKO_SIT_MS = 2000;
export const NEKO_SIT_JITTER_MS = 1000;
/** Wander: with no element to visit, a random point at least this far inside the window. */
export const NEKO_WANDER_INSET = 80;
/** Wander: the elements the cat visits, as in the portfolio. */
export const NEKO_WANDER_SELECTORS = 'h1, h2, h3, p, a, button, li, [class*="icon"]';

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
/** 0 = follow, 1 = flee, 2 = wander, as in the portfolio. */
export type NekoMode = 0 | 1 | 2;

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface NekoState {
  /** The cat's centre, in viewport pixels. */
  x: number;
  y: number;
  frame: number;
  tickCount: number;
  phase: NekoPhase;
  wanderTarget: Point;
  /** Wander: sitting at a target until Oneko.tsx's timer ends the sit. */
  sitting: boolean;
  /** The background-position of the sprite sheet, e.g. "-96px -96px". */
  bgPos: string;
}

export interface NekoInput {
  mode: NekoMode;
  mouseX: number;
  mouseY: number;
  innerWidth: number;
  innerHeight: number;
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

/**
 * randTarget: the centre of a random fully visible candidate, or a random point inside
 * the window when none is visible. `boxes` are the candidates' bounding rectangles.
 */
export function pickWanderTarget(boxes: readonly Box[], innerWidth: number, innerHeight: number, random: () => number): Point {
  const visible = boxes.filter(
    (r) => r.width > 0 && r.height > 0 && r.top > 0 && r.bottom < innerHeight && r.left > 0 && r.right < innerWidth,
  );
  if (visible.length === 0) {
    return {
      x: NEKO_WANDER_INSET + random() * (innerWidth - 2 * NEKO_WANDER_INSET),
      y: NEKO_WANDER_INSET + random() * (innerHeight - 2 * NEKO_WANDER_INSET),
    };
  }
  const r = visible[Math.floor(random() * visible.length)] as Box;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** initState: in the middle of the window, idle, with a first wander target. */
export function initialNeko(innerWidth: number, innerHeight: number, wanderTarget: Point): NekoState {
  return {
    x: innerWidth / 2,
    y: innerHeight / 2,
    frame: 0,
    tickCount: 0,
    phase: 'idle',
    wanderTarget,
    sitting: false,
    bgPos: spritePosition('idle', 0),
  };
}

/** How long a wander sit lasts, in ms. */
export function sitMs(random: () => number): number {
  return NEKO_SIT_MS + random() * NEKO_SIT_JITTER_MS;
}

/** The sit timer's end: stand up, take the next target, run. */
export function endSit(state: NekoState, nextTarget: Point): NekoState {
  return { ...state, sitting: false, wanderTarget: nextTarget, phase: 'running' };
}

/**
 * The mode effect: switching to wander drops any sit and takes a new target; switching
 * to follow or flee drops any sit and wakes the cat (idle, count from 0).
 */
export function changeMode(state: NekoState, mode: NekoMode, nextTarget: Point): NekoState {
  if (mode === 2) return { ...state, sitting: false, wanderTarget: nextTarget };
  return { ...state, sitting: false, phase: 'idle', tickCount: 0 };
}

/** The next mode when the cat is clicked. */
export function nextMode(mode: NekoMode): NekoMode {
  return ((mode + 1) % 3) as NekoMode;
}

function runToward(s: NekoState, tx: number, ty: number, dist: number, input: NekoInput): void {
  const dx = tx - s.x;
  const dy = ty - s.y;
  s.phase = 'running';
  const step = Math.min(NEKO_SPEED, dist);
  s.x = Math.max(NEKO_EDGE, Math.min(input.innerWidth - NEKO_EDGE, s.x + (dx / dist) * step));
  s.y = Math.max(NEKO_EDGE, Math.min(input.innerHeight - NEKO_EDGE, s.y + (dy / dist) * step));
  s.bgPos = spritePosition(angleToDir(Math.atan2(dy, dx) * (180 / Math.PI)), s.frame);
}

/** One 100 ms tick of the portfolio's tick(). */
export function nekoFrame(state: NekoState, input: NekoInput): NekoState {
  const s: NekoState = { ...state, frame: state.frame + 1, tickCount: state.tickCount + 1 };

  if (input.mode === 0) {
    const dx = input.mouseX - s.x;
    const dy = input.mouseY - s.y;
    const dist = Math.hypot(dx, dy);
    if (dist < NEKO_NEAR_PX) {
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
    runToward(s, input.mouseX, input.mouseY, dist, input);
    return s;
  }

  if (input.mode === 1) {
    const dx = s.x - input.mouseX; // away from the pointer
    const dy = s.y - input.mouseY;
    const dist = Math.hypot(dx, dy);
    if (dist > NEKO_FLEE_RADIUS) {
      s.bgPos = spritePosition('idle', s.frame);
      return s;
    }
    const step = NEKO_SPEED * NEKO_FLEE_FACTOR;
    const nx = s.x + (dx / (dist || 1)) * step;
    const ny = s.y + (dy / (dist || 1)) * step;
    s.x = Math.min(Math.max(nx, NEKO_FLEE_MARGIN), input.innerWidth - NEKO_FLEE_MARGIN);
    s.y = Math.min(Math.max(ny, NEKO_FLEE_MARGIN), input.innerHeight - NEKO_FLEE_MARGIN);
    s.bgPos = spritePosition(angleToDir(Math.atan2(dy, dx) * (180 / Math.PI)), s.frame);
    return s;
  }

  // Wander.
  if (s.sitting) return s;
  const dist = Math.hypot(s.wanderTarget.x - s.x, s.wanderTarget.y - s.y);
  if (dist < NEKO_NEAR_PX) {
    s.sitting = true;
    s.phase = 'sleeping';
    s.bgPos = spritePosition('sleeping', 0);
    return s;
  }
  runToward(s, s.wanderTarget.x, s.wanderTarget.y, dist, input);
  return s;
}
