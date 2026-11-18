/**
 * The ASCII cat field behind the chat, as pure functions. No DOM, no clock:
 * the caller passes the grid size and a timestamp (requestAnimationFrame's),
 * and gets text back. The art is drawn for this project.
 *
 *   createField(seed)                       -> FieldState (the drifting cats)
 *   stepNeko(neko, pointer, tMs, cols, rows) -> Neko       (the pointer cat, one step)
 *   renderLayers(cols, rows, tMs, state)    -> string[][] (far, middle, near)
 *   renderFrame(cols, rows, tMs, state)     -> string[]   (the three, composited)
 *
 * Drifting cats are a closed-form function of time, so a frame never depends
 * on the frames before it and nothing accumulates. Only the pointer cat has
 * state, and stepNeko returns a new object each step.
 */

export type CatKind = 'walker' | 'sitter' | 'sleeper' | 'player';
export type Layer = 0 | 1 | 2;
export const LAYERS = 3;

export interface Cat {
  kind: CatKind;
  /** Starting position across the wrap width, 0..1. */
  x0: number;
  /** Row position, 0 (top) .. 1 (bottom). */
  y: number;
  /** Columns per second. The sign is the direction. */
  speed: number;
  layer: Layer;
  /** Offset into the cat's animation cycles, in ms, so cats are out of step. */
  phase: number;
}

export type NekoMode = 'run' | 'sit' | 'sleep';

export interface Neko {
  /** Top-left cell, fractional. */
  x: number;
  y: number;
  mode: NekoMode;
  facing: 1 | -1;
  /** The last pointer cell seen. */
  target: { col: number; row: number } | null;
  /** When the pointer last moved (or the neko last ran), in ms. */
  stillSinceMs: number;
  lastStepMs: number | null;
}

export interface FieldState {
  cats: Cat[];
  neko: Neko | null;
}

// ------------------------------------------------------------- tunables
// Animation choices, not measurements.

/** Drifting cats by kind: columns per second on the near layer. */
const BASE_SPEED: Record<CatKind, number> = { walker: 5, sitter: 4, sleeper: 0.6, player: 2.5 };
/** Speed factor per layer: far cats move slower. */
const LAYER_SPEED: Record<Layer, number> = { 0: 0.45, 1: 0.7, 2: 1 };
/** Grid cells per drifting cat; fewer cats on a small screen. */
const CELLS_PER_CAT = 600;
const MIN_CATS = 4;
const MAX_CATS = 10;

const WALK_FRAME_MS = 180;
const SIT_WALK_MS = 5200;
const SIT_REST_MS = 6400;
const TAIL_FRAME_MS = 650;
const BLINK_EVERY_MS = 2900;
const BLINK_MS = 220;
const ZZZ_FRAME_MS = 750;
const PLAY_CYCLE_MS = 2600;
/** Columns the yarn rolls (and the cat then chases) per play cycle. */
const PLAY_ROLL = 6;

export const NEKO_SPEED_COLS = 26;
export const NEKO_SPEED_ROWS = 11;
/** The neko stops this far from the pointer, in columns and rows. */
export const NEKO_GAP_COLS = 4;
export const NEKO_GAP_ROWS = 2;
/** With the pointer still this long, the neko falls asleep. */
export const NEKO_SLEEP_AFTER_MS = 6000;
/** Longest step a single frame may take (after a hidden tab, say). */
export const NEKO_MAX_STEP_MS = 200;
const NEKO_RUN_FRAME_MS = 110;

// -------------------------------------------------------------- sprites
// Original art. Every frame of one sprite has the same height. Spaces are
// transparent when drawn.

const WALK_TOP = ['         /\\_/\\ ', '  ~_____/ o o\\ ', ' (__________^_/'];
const WALK: string[][] = [
  [...WALK_TOP, '   \\ \\   \\ \\  '],
  [...WALK_TOP, '    | |   | |  '],
  [...WALK_TOP, '    / /   / /  '],
  [...WALK_TOP, '    | |   | |  '],
];

function sitSprite(tail: 0 | 1, blink: boolean): string[] {
  return [
    '  /\\_/\\   ',
    blink ? ' ( - - )  ' : ' ( o o )  ',
    ' =\\ ^ /=  ',
    tail === 0 ? '  /   \\ ) ' : '  /   \\   ',
    tail === 0 ? ' (_| |_)/ ' : ' (_| |_)_~',
  ];
}

const SLEEP_BODY = ['    ,-\'\'\'-.   ', '  _/ -.-   \\_ ', ' (__,_____,__)~'];
const SLEEP: string[][] = [
  ['               ', '       z       ', ...SLEEP_BODY],
  ['        z      ', '               ', ...SLEEP_BODY],
  ['         Z     ', '       z       ', ...SLEEP_BODY],
];

const PLAY_BACK = [' /\\_/\\   ', '( o.o )  ', ' )   ( \\ ', '(_|_|_)~ '];
const PLAY_BAT = [' /\\_/\\   ', '( o.o )  ', ' )   (--\'', '(_|_|_)~ '];
const PLAY_WIDTH = 9;

const NEKO_RUN: string[][] = [
  ['   /\\_/\\ ', '~=/ o.o )', '  /_/ \\_\\'],
  ['   /\\_/\\ ', '~=/ o.o )', '   |_ |_ '],
];
const NEKO_SIT = ['  /\\_/\\  ', ' ( o.o ) ', ' (")_(")~'];
const NEKO_BLINK = ['  /\\_/\\  ', ' ( -.- ) ', ' (")_(")~'];
const NEKO_SLEEP: string[][] = [
  ['       z ', '  /\\_/\\  ', ' ( -.- )~'],
  ['        Z', '  /\\_/\\ z', ' ( -.- )~'],
];
export const NEKO_WIDTH = 9;
export const NEKO_HEIGHT = 3;

const MIRROR: Record<string, string> = { '/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<', '[': ']', ']': '[', '{': '}', '}': '{', "'": '`', '`': "'" };

/** The sprite facing the other way. */
export function mirror(sprite: string[]): string[] {
  const width = spriteWidth(sprite);
  return sprite.map((line) =>
    [...line.padEnd(width)]
      .reverse()
      .map((char) => MIRROR[char] ?? char)
      .join(''),
  );
}

export function spriteWidth(sprite: string[]): number {
  return sprite.reduce((max, line) => Math.max(max, line.length), 0);
}

// ---------------------------------------------------------------- setup

/** mulberry32: a small seeded generator, so a field is reproducible. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KIND_ORDER: CatKind[] = ['walker', 'sleeper', 'player', 'sitter'];

/** MAX_CATS cats, every kind present among the first four, spread over rows and layers. */
export function createField(seed: number, withNeko = true): FieldState {
  const next = random(seed);
  const cats: Cat[] = [];
  for (let index = 0; index < MAX_CATS; index += 1) {
    const kind = KIND_ORDER[index % KIND_ORDER.length] as CatKind;
    const layer = (index % LAYERS) as Layer;
    const direction = next() < 0.5 ? -1 : 1;
    // Spread rows in bands so cats do not pile on one line.
    const band = (index * 0.618) % 1;
    cats.push({
      kind,
      x0: next(),
      y: Math.min(1, Math.max(0, band + (next() - 0.5) * 0.08)),
      speed: direction * BASE_SPEED[kind] * LAYER_SPEED[layer] * (0.8 + next() * 0.4),
      layer,
      phase: Math.floor(next() * 10000),
    });
  }
  return { cats, neko: withNeko ? createNeko() : null };
}

export function createNeko(): Neko {
  return { x: 2, y: 2, mode: 'sit', facing: 1, target: null, stillSinceMs: 0, lastStepMs: null };
}

/** How many of the field's cats a grid this size shows. */
export function catsFor(cols: number, rows: number): number {
  return Math.min(MAX_CATS, Math.max(MIN_CATS, Math.round((cols * rows) / CELLS_PER_CAT)));
}

// -------------------------------------------------------------- drawing

function emptyGrid(cols: number, rows: number): string[][] {
  return Array.from({ length: rows }, () => new Array<string>(cols).fill(' '));
}

/** Draws a sprite with its top-left at (x, y); spaces are transparent, cells off the grid are dropped. */
function blit(grid: string[][], sprite: string[], x: number, y: number): void {
  const left = Math.round(x);
  const top = Math.round(y);
  sprite.forEach((line, dy) => {
    const row = grid[top + dy];
    if (row === undefined) return;
    for (let dx = 0; dx < line.length; dx += 1) {
      const char = line[dx] as string;
      const col = left + dx;
      if (char !== ' ' && col >= 0 && col < row.length) row[col] = char;
    }
  });
}

function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

/** A cat's left column, wrapping so it leaves one edge and re-enters at the other. */
function wrapX(cols: number, width: number, x0: number, travelled: number): number {
  const span = cols + width * 2;
  return mod(x0 * span + travelled, span) - width;
}

function rowFor(cat: Cat, rows: number, height: number): number {
  return Math.round(cat.y * Math.max(0, rows - height));
}

function frameAt(t: number, frameMs: number, count: number): number {
  return Math.floor(mod(t, frameMs * count) / frameMs);
}

function facingSprite(sprite: string[], speed: number): string[] {
  return speed < 0 ? mirror(sprite) : sprite;
}

/** Where a cat is and what it looks like at time t: sprites with offsets from its left column. */
export function catPose(cat: Cat, tMs: number): { travelled: number; parts: { sprite: string[]; dx: number }[]; width: number } {
  const t = tMs + cat.phase;
  switch (cat.kind) {
    case 'walker': {
      const sprite = WALK[frameAt(t, WALK_FRAME_MS, WALK.length)] as string[];
      return { travelled: (cat.speed * t) / 1000, parts: [{ sprite: facingSprite(sprite, cat.speed), dx: 0 }], width: spriteWidth(sprite) };
    }
    case 'sitter': {
      // Walks a while, sits a while (tail flicks, eyes blink), walks on.
      const cycle = SIT_WALK_MS + SIT_REST_MS;
      const done = Math.floor(t / cycle);
      const into = mod(t, cycle);
      const travelled = (cat.speed * (done * SIT_WALK_MS + Math.min(into, SIT_WALK_MS))) / 1000;
      const width = spriteWidth(WALK[0] as string[]);
      if (into < SIT_WALK_MS) {
        // One blank line on top, so walking and sitting share a baseline.
        const walk = ['', ...(WALK[frameAt(t, WALK_FRAME_MS, WALK.length)] as string[])];
        return { travelled, parts: [{ sprite: facingSprite(walk, cat.speed), dx: 0 }], width };
      }
      const tail = frameAt(t, TAIL_FRAME_MS, 2) as 0 | 1;
      const blink = mod(t, BLINK_EVERY_MS) < BLINK_MS;
      const sit = sitSprite(tail, blink);
      return { travelled, parts: [{ sprite: facingSprite(sit, cat.speed), dx: 3 }], width };
    }
    case 'sleeper': {
      const sprite = SLEEP[frameAt(t, ZZZ_FRAME_MS, SLEEP.length)] as string[];
      return { travelled: (cat.speed * t) / 1000, parts: [{ sprite, dx: 0 }], width: spriteWidth(sprite) };
    }
    case 'player': {
      // Each cycle: bat the yarn, it rolls PLAY_ROLL columns, the cat chases it.
      const done = Math.floor(t / PLAY_CYCLE_MS);
      const u = mod(t, PLAY_CYCLE_MS) / PLAY_CYCLE_MS;
      const chase = u < 0.6 ? 0 : ((u - 0.6) / 0.4) * PLAY_ROLL;
      const roll = u < 0.2 ? 0 : u < 0.6 ? PLAY_ROLL * (1 - (1 - (u - 0.2) / 0.4) ** 2) : PLAY_ROLL;
      const direction = cat.speed < 0 ? -1 : 1;
      const travelled = direction * (done * PLAY_ROLL + chase);
      const cat_ = u < 0.2 ? PLAY_BAT : PLAY_BACK;
      const gap = 1 + roll - chase;
      const rolling = u >= 0.2 && u < 0.6;
      const thread = rolling && frameAt(t, 120, 2) === 0 ? '~' : '-';
      const ball = [`${rolling ? thread : ' '}@`];
      const ballDx = direction > 0 ? PLAY_WIDTH - 1 + gap : -gap - 1;
      const ballSprite = direction > 0 ? ball : mirror(ball);
      const height = cat_.length;
      return {
        travelled,
        parts: [
          { sprite: facingSprite(cat_, direction), dx: 0 },
          { sprite: [...new Array<string>(height - 1).fill(''), ...ballSprite], dx: Math.round(ballDx) },
        ],
        width: PLAY_WIDTH + PLAY_ROLL + 2,
      };
    }
  }
}

function catHeight(cat: Cat): number {
  if (cat.kind === 'sleeper') return (SLEEP[0] as string[]).length;
  if (cat.kind === 'player') return PLAY_BACK.length;
  return sitSprite(0, false).length;
}

/** The neko's sprite at time t. */
export function nekoSprite(neko: Neko, tMs: number): string[] {
  if (neko.mode === 'run') {
    const sprite = NEKO_RUN[frameAt(tMs, NEKO_RUN_FRAME_MS, NEKO_RUN.length)] as string[];
    return neko.facing < 0 ? mirror(sprite) : sprite;
  }
  if (neko.mode === 'sleep') return NEKO_SLEEP[frameAt(tMs, ZZZ_FRAME_MS, NEKO_SLEEP.length)] as string[];
  return mod(tMs, BLINK_EVERY_MS) < BLINK_MS ? NEKO_BLINK : NEKO_SIT;
}

/**
 * Three grids, far to near, each `rows` strings of exactly `cols` characters.
 * The neko is drawn on the near layer.
 */
export function renderLayers(cols: number, rows: number, tMs: number, state: FieldState): string[][] {
  const width = Math.max(0, Math.floor(cols));
  const height = Math.max(0, Math.floor(rows));
  const grids = [emptyGrid(width, height), emptyGrid(width, height), emptyGrid(width, height)];
  const shown = state.cats.slice(0, catsFor(width, height));
  for (const cat of shown) {
    const pose = catPose(cat, tMs);
    const left = wrapX(width, pose.width, cat.x0, pose.travelled);
    const top = rowFor(cat, height, catHeight(cat));
    const grid = grids[cat.layer] as string[][];
    for (const part of pose.parts) blit(grid, part.sprite, left + part.dx, top);
  }
  if (state.neko !== null) blit(grids[2] as string[][], nekoSprite(state.neko, tMs), state.neko.x, state.neko.y);
  return grids.map((grid) => grid.map((row) => row.join('')));
}

/** One composited frame: nearer layers drawn over farther ones. */
export function renderFrame(cols: number, rows: number, tMs: number, state: FieldState): string[] {
  const layers = renderLayers(cols, rows, tMs, state);
  const out = (layers[0] as string[]).map((row) => [...row]);
  for (const layer of layers.slice(1)) {
    layer.forEach((row, y) => {
      const target = out[y] as string[];
      for (let x = 0; x < row.length; x += 1) if (row[x] !== ' ') target[x] = row[x] as string;
    });
  }
  return out.map((row) => row.join(''));
}

// ---------------------------------------------------------------- neko

/**
 * One step of the pointer cat. It runs toward the pointer and stops a short
 * gap away, sits, and falls asleep when the pointer has been still for
 * NEKO_SLEEP_AFTER_MS. Moving the pointer wakes it. `pointer` is a grid cell,
 * or null when there has been none.
 */
export function stepNeko(
  neko: Neko,
  pointer: { col: number; row: number } | null,
  tMs: number,
  cols: number,
  rows: number,
): Neko {
  const dt = neko.lastStepMs === null ? 0 : Math.min(NEKO_MAX_STEP_MS, Math.max(0, tMs - neko.lastStepMs));
  const moved =
    pointer !== null && (neko.target === null || neko.target.col !== pointer.col || neko.target.row !== pointer.row);
  const target = pointer ?? neko.target;
  let { x, y, facing } = neko;
  let stillSinceMs = moved ? tMs : neko.stillSinceMs;
  let mode: NekoMode;

  const dx = target === null ? 0 : target.col - (x + NEKO_WIDTH / 2);
  const dy = target === null ? 0 : target.row - (y + NEKO_HEIGHT / 2);
  const far = Math.abs(dx) > NEKO_GAP_COLS || Math.abs(dy) > NEKO_GAP_ROWS;
  if (target !== null && far) {
    mode = 'run';
    stillSinceMs = tMs;
    const seconds = dt / 1000;
    // Move along both axes at once; cells are about twice as tall as wide.
    const wantX = Math.abs(dx) > NEKO_GAP_COLS ? dx - Math.sign(dx) * NEKO_GAP_COLS : 0;
    const wantY = Math.abs(dy) > NEKO_GAP_ROWS ? dy - Math.sign(dy) * NEKO_GAP_ROWS : 0;
    const length = Math.hypot(wantX / NEKO_SPEED_COLS, wantY / NEKO_SPEED_ROWS);
    const share = length === 0 ? 0 : Math.min(1, seconds / length);
    x += wantX * share;
    y += wantY * share;
    if (Math.abs(dx) >= 1) facing = dx < 0 ? -1 : 1;
  } else {
    mode = tMs - stillSinceMs >= NEKO_SLEEP_AFTER_MS ? 'sleep' : 'sit';
  }
  x = Math.min(Math.max(0, x), Math.max(0, cols - NEKO_WIDTH));
  y = Math.min(Math.max(0, y), Math.max(0, rows - NEKO_HEIGHT));
  return { x, y, mode, facing, target: target === null ? null : { ...target }, stillSinceMs, lastStepMs: tMs };
}
