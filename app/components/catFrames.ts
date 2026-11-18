/**
 * The ASCII cat field behind the chat, as pure functions. No DOM, no clock:
 * the caller passes the grid size and a timestamp (requestAnimationFrame's),
 * and gets text back. The art is drawn for this project.
 *
 *   createField(seed)                       -> FieldState (the drifting cats)
 *   renderLayers(cols, rows, tMs, state)    -> string[][] (far, middle, near)
 *   renderFrame(cols, rows, tMs, state)     -> string[]   (the three, composited)
 *
 * Drifting cats are a closed-form function of time, so a frame never depends
 * on the frames before it and nothing accumulates. The pointer cat is oneko
 * (Oneko.tsx), not part of this field.
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

export interface FieldState {
  cats: Cat[];
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
export function createField(seed: number): FieldState {
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
  return { cats };
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

/**
 * Three grids, far to near, each `rows` strings of exactly `cols` characters.
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
