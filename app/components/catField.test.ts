import { describe, expect, it } from 'vitest';
import {
  catPose,
  catsFor,
  createField,
  createNeko,
  mirror,
  NEKO_GAP_COLS,
  NEKO_GAP_ROWS,
  NEKO_HEIGHT,
  NEKO_MAX_STEP_MS,
  NEKO_SLEEP_AFTER_MS,
  NEKO_WIDTH,
  nekoSprite,
  renderFrame,
  renderLayers,
  stepNeko,
  type Cat,
  type FieldState,
  type Neko,
} from './catField';

const COLS = 120;
const ROWS = 40;

function only(cat: Partial<Cat> & Pick<Cat, 'kind'>): FieldState {
  return { cats: [{ x0: 0.3, y: 0.5, speed: 4, layer: 2, phase: 0, ...cat }], neko: null };
}

function nonBlank(lines: string[]): number {
  return lines.join('').replace(/ /g, '').length;
}

/** Leftmost column with a non-space character, across all rows. */
function leftmost(lines: string[]): number {
  return Math.min(...lines.map((line) => line.search(/\S/)).filter((index) => index >= 0));
}

/** Runs the neko for `ms` at 12 fps toward `pointer`. */
function run(neko: Neko, pointer: { col: number; row: number } | null, fromMs: number, ms: number): Neko {
  let current = neko;
  for (let t = fromMs; t <= fromMs + ms; t += 1000 / 12) current = stepNeko(current, pointer, t, COLS, ROWS);
  return current;
}

describe('renderFrame', () => {
  it('returns exactly rows lines of exactly cols characters', () => {
    const frame = renderFrame(COLS, ROWS, 1234, createField(1));
    expect(frame).toHaveLength(ROWS);
    for (const line of frame) expect(line).toHaveLength(COLS);
  });

  it('is a pure function of its inputs', () => {
    const state = createField(5);
    expect(renderFrame(COLS, ROWS, 4321, state)).toEqual(renderFrame(COLS, ROWS, 4321, state));
    expect(renderFrame(COLS, ROWS, 4321, createField(5))).toEqual(renderFrame(COLS, ROWS, 4321, state));
  });

  it('changes over time', () => {
    const state = createField(2);
    expect(renderFrame(COLS, ROWS, 0, state)).not.toEqual(renderFrame(COLS, ROWS, 1500, state));
  });

  it('survives tiny and empty grids (a resize recomputes the grid)', () => {
    const state = createField(3);
    expect(renderFrame(0, 0, 100, state)).toEqual([]);
    const tiny = renderFrame(5, 2, 100, state);
    expect(tiny).toHaveLength(2);
    for (const line of tiny) expect(line).toHaveLength(5);
    const wide = renderFrame(300, 80, 100, state);
    expect(wide).toHaveLength(80);
    expect(wide[0]).toHaveLength(300);
  });

  it('draws only cat art: no stray characters outside the sprites', () => {
    const frame = renderFrame(COLS, ROWS, 777, createField(4)).join('');
    expect(frame).toMatch(/^[ /\\_~()=o.^|z'Z,\-@`"<>{}[\]Y]*$/);
  });
});

describe('the drifting cats', () => {
  it('createField has every kind among the cats a phone-sized grid shows', () => {
    const state = createField(9);
    const shown = state.cats.slice(0, catsFor(40, 50));
    expect(new Set(shown.map((cat) => cat.kind))).toEqual(new Set(['walker', 'sitter', 'sleeper', 'player']));
  });

  it('shows more cats on a bigger grid, within bounds', () => {
    expect(catsFor(10, 10)).toBeLessThan(catsFor(200, 60));
    expect(catsFor(10, 10)).toBeGreaterThanOrEqual(4);
    expect(catsFor(1000, 1000)).toBeLessThanOrEqual(createField(1).cats.length);
  });

  it('cats sit on different layers and move at different speeds, so they are not in lockstep', () => {
    const { cats } = createField(11);
    expect(new Set(cats.map((cat) => cat.layer)).size).toBe(3);
    expect(new Set(cats.map((cat) => cat.speed.toFixed(3))).size).toBe(cats.length);
    expect(new Set(cats.map((cat) => cat.phase)).size).toBeGreaterThan(1);
  });

  it('far cats are slower than near cats of the same kind', () => {
    const { cats } = createField(13);
    const walkers = cats.filter((cat) => cat.kind === 'walker');
    const far = walkers.filter((cat) => cat.layer === 0).map((cat) => Math.abs(cat.speed));
    const near = walkers.filter((cat) => cat.layer === 2).map((cat) => Math.abs(cat.speed));
    expect(far.length).toBeGreaterThan(0);
    expect(near.length).toBeGreaterThan(0);
    expect(Math.max(...far)).toBeLessThan(Math.min(...near));
  });

  it('draws each layer separately, far to near', () => {
    const layers = renderLayers(COLS, ROWS, 0, only({ kind: 'walker', layer: 0 }));
    expect(layers).toHaveLength(3);
    expect(nonBlank(layers[0]!)).toBeGreaterThan(0);
    expect(nonBlank(layers[1]!)).toBe(0);
    expect(nonBlank(layers[2]!)).toBe(0);
  });

  it('a walking cat alternates its legs', () => {
    const cat: Cat = { kind: 'walker', x0: 0.3, y: 0.5, speed: 4, layer: 2, phase: 0 };
    const legs = (t: number) => {
      const sprite = catPose(cat, t).parts[0]!.sprite;
      return sprite[sprite.length - 1];
    };
    const seen = new Set([0, 180, 360, 540].map(legs));
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(legs(0)).toContain('\\ \\');
    expect(legs(360)).toContain('/ /');
  });

  it('a walking cat moves across and wraps back in from the other edge', () => {
    const state = only({ kind: 'walker', speed: 10 });
    const start = leftmost(renderFrame(COLS, ROWS, 0, state));
    const later = leftmost(renderFrame(COLS, ROWS, 1000, state));
    expect(later - start).toBe(10);
    // After a full lap (cols plus twice the sprite width at 10 cols/s) it is back.
    const pose = catPose(state.cats[0]!, 0);
    const lapMs = ((COLS + pose.width * 2) / 10) * 1000;
    expect(leftmost(renderFrame(COLS, ROWS, lapMs, state))).toBe(start);
    // Halfway through the lap it is off one side or coming in from the other, never stuck.
    const frames = Array.from({ length: 40 }, (_, index) => renderFrame(COLS, ROWS, (lapMs * index) / 40, state));
    expect(frames.some((frame) => nonBlank(frame) === 0 || leftmost(frame) === 0)).toBe(true);
  });

  it('a cat walking left is drawn mirrored', () => {
    const right = catPose({ kind: 'walker', x0: 0.3, y: 0.5, speed: 4, layer: 2, phase: 0 }, 0).parts[0]!.sprite;
    const left = catPose({ kind: 'walker', x0: 0.3, y: 0.5, speed: -4, layer: 2, phase: 0 }, 0).parts[0]!.sprite;
    expect(left).toEqual(mirror(right));
    expect(mirror(['(/<'])).toEqual(['>\\)']);
  });

  it('a sitting cat stops, flicks its tail and blinks', () => {
    const cat: Cat = { kind: 'sitter', x0: 0.3, y: 0.5, speed: 4, layer: 1, phase: 0 };
    const sitting = Array.from({ length: 60 }, (_, index) => 5200 + index * 100).map((t) => catPose(cat, t));
    // Still while sitting.
    expect(new Set(sitting.map((pose) => pose.travelled)).size).toBe(1);
    const frames = new Set(sitting.map((pose) => pose.parts[0]!.sprite.join('\n')));
    expect(frames.size).toBeGreaterThanOrEqual(3);
    expect([...frames].some((frame) => frame.includes('- -'))).toBe(true);
    expect([...frames].some((frame) => frame.includes('o o'))).toBe(true);
    // And walks on afterwards.
    expect(catPose(cat, 13000).travelled).toBeGreaterThan(catPose(cat, 11700).travelled);
  });

  it('a sleeping cat has a z that rises', () => {
    const cat: Cat = { kind: 'sleeper', x0: 0.3, y: 0.5, speed: 0, layer: 0, phase: 0 };
    const zRow = (t: number) => catPose(cat, t).parts[0]!.sprite.findIndex((line) => /[zZ]/.test(line));
    expect(zRow(0)).toBe(1);
    expect(zRow(750)).toBe(0);
    const frames = new Set([0, 750, 1500].map((t) => catPose(cat, t).parts[0]!.sprite.join('\n')));
    expect(frames.size).toBe(3);
  });

  it('a playing cat bats a yarn ball that rolls away, then catches up', () => {
    const cat: Cat = { kind: 'player', x0: 0.3, y: 0.5, speed: 2, layer: 2, phase: 0 };
    const ballAt = (t: number) => catPose(cat, t).parts[1]!.dx;
    const sprite = (t: number) => catPose(cat, t).parts[0]!.sprite.join('\n');
    expect(sprite(100)).not.toEqual(sprite(1000)); // paw out, then back
    expect(catPose(cat, 0).parts[1]!.sprite.join('')).toContain('@');
    expect(ballAt(1500)).toBeGreaterThan(ballAt(100)); // rolled away
    expect(ballAt(2550)).toBeLessThan(ballAt(1500)); // the cat caught up
    expect(catPose(cat, 2550).travelled).toBeGreaterThan(catPose(cat, 1500).travelled);
  });
});

describe('the pointer cat (neko)', () => {
  it('runs toward the pointer and faces it', () => {
    const start = { ...createNeko(), x: 10, y: 10 };
    const after = run(start, { col: 90, row: 30 }, 0, 500);
    expect(after.mode).toBe('run');
    expect(after.x).toBeGreaterThan(start.x);
    expect(after.y).toBeGreaterThan(start.y);
    expect(after.facing).toBe(1);
    const back = run(after, { col: 2, row: 30 }, 600, 300);
    expect(back.facing).toBe(-1);
  });

  it('sits a short distance from the pointer when it arrives', () => {
    const arrived = run({ ...createNeko(), x: 10, y: 10 }, { col: 60, row: 20 }, 0, 6000);
    expect(arrived.mode).toBe('sit');
    const centreX = arrived.x + NEKO_WIDTH / 2;
    const centreY = arrived.y + NEKO_HEIGHT / 2;
    expect(Math.abs(60 - centreX)).toBeLessThanOrEqual(NEKO_GAP_COLS + 0.01);
    expect(Math.abs(20 - centreY)).toBeLessThanOrEqual(NEKO_GAP_ROWS + 0.01);
    expect(Math.abs(60 - centreX)).toBeGreaterThan(NEKO_GAP_COLS - 1);
  });

  it('falls asleep when the pointer stays still, and wakes when it moves', () => {
    const arrived = run({ ...createNeko(), x: 10, y: 10 }, { col: 30, row: 12 }, 0, 3000);
    expect(arrived.mode).toBe('sit');
    const asleep = run(arrived, { col: 30, row: 12 }, 3100, NEKO_SLEEP_AFTER_MS + 500);
    expect(asleep.mode).toBe('sleep');
    expect(nekoSprite(asleep, 0).join('')).toMatch(/[zZ]/);
    // A small move that stays within the gap wakes it without making it run.
    const near = { col: Math.round(asleep.x + NEKO_WIDTH / 2), row: Math.round(asleep.y + NEKO_HEIGHT / 2) };
    const nudged = stepNeko(asleep, near, 3100 + NEKO_SLEEP_AFTER_MS + 600, COLS, ROWS);
    expect(nudged.mode).toBe('sit');
  });

  it('sits, then sleeps, when there has been no pointer at all', () => {
    const idle = run(createNeko(), null, 0, 1000);
    expect(idle.mode).toBe('sit');
    expect(run(idle, null, 1100, NEKO_SLEEP_AFTER_MS).mode).toBe('sleep');
  });

  it('never jumps more than one capped step after a long gap (a hidden tab)', () => {
    const before = stepNeko({ ...createNeko(), x: 0, y: 0 }, { col: 110, row: 35 }, 0, COLS, ROWS);
    const after = stepNeko(before, { col: 110, row: 35 }, 60_000, COLS, ROWS);
    const moved = Math.hypot(after.x - before.x, (after.y - before.y) * 2);
    const capped = run({ ...createNeko(), x: 0, y: 0 }, { col: 110, row: 35 }, 0, NEKO_MAX_STEP_MS);
    expect(moved).toBeLessThanOrEqual(Math.hypot(capped.x, capped.y * 2) * 1.5 + 1);
  });

  it('stays on the grid', () => {
    const far = run(createNeko(), { col: 5000, row: 5000 }, 0, 20_000);
    expect(far.x).toBeLessThanOrEqual(COLS - NEKO_WIDTH);
    expect(far.y).toBeLessThanOrEqual(ROWS - NEKO_HEIGHT);
    const negative = run(createNeko(), { col: -50, row: -50 }, 0, 5000);
    expect(negative.x).toBeGreaterThanOrEqual(0);
    expect(negative.y).toBeGreaterThanOrEqual(0);
  });

  it('returns a new object and leaves the old one alone', () => {
    const neko = createNeko();
    const copy = structuredClone(neko);
    const next = stepNeko(neko, { col: 50, row: 20 }, 100, COLS, ROWS);
    expect(next).not.toBe(neko);
    expect(neko).toEqual(copy);
  });

  it('is drawn on the near layer, running frames alternating', () => {
    const neko: Neko = { ...createNeko(), mode: 'run', x: 20, y: 5 };
    const layers = renderLayers(COLS, ROWS, 0, { cats: [], neko });
    expect(nonBlank(layers[2]!)).toBeGreaterThan(0);
    expect(nonBlank(layers[0]!) + nonBlank(layers[1]!)).toBe(0);
    expect(nekoSprite(neko, 0)).not.toEqual(nekoSprite(neko, 110));
  });
});
