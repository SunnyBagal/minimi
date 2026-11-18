import { describe, expect, it } from 'vitest';
import {
  angleToDir,
  changeMode,
  endSit,
  initialNeko,
  nekoFrame,
  nextMode,
  pickWanderTarget,
  sitMs,
  spritePosition,
  SPRITE_SETS,
  type Box,
  type NekoInput,
  type NekoMode,
  type NekoState,
} from './onekoCore';

// The portfolio's numbers, written out here so a change to the constants fails a test.
const SPEED = 10;
const NEAR = 48;
const FLEE_RADIUS = 220;
const FLEE_STEP = 14;
const VIEW = { innerWidth: 1280, innerHeight: 800 };

const start = (over: Partial<NekoState> = {}): NekoState => ({ ...initialNeko(1280, 800, { x: 900, y: 200 }), ...over });
const input = (mode: NekoMode, mouseX: number, mouseY: number): NekoInput => ({ mode, mouseX, mouseY, ...VIEW });
const run = (state: NekoState, ticks: number, at: NekoInput): NekoState => {
  let current = state;
  for (let i = 0; i < ticks; i += 1) current = nekoFrame(current, at);
  return current;
};
const sprites = (name: keyof typeof SPRITE_SETS) => SPRITE_SETS[name].map(([x, y]) => `${x * 32}px ${y * 32}px`);
const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe('oneko sprites and directions (portfolio useNeko)', () => {
  it('keeps the portfolio sprite map and its sheet offsets (32 px cells)', () => {
    expect(Object.keys(SPRITE_SETS)).toEqual(['idle', 'alert', 'tired', 'sleeping', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
    expect(spritePosition('idle', 0)).toBe('-96px -96px');
    expect(spritePosition('alert', 0)).toBe('-224px -96px');
    expect(spritePosition('E', 0)).toBe('-96px 0px');
    expect(spritePosition('E', 1)).toBe('-96px -32px');
    expect(spritePosition('sleeping', 3)).toBe('-64px -32px');
  });

  it('maps angles to the eight directions as the portfolio does', () => {
    expect([0, 45, 90, 135, 180, -45, -90, -135].map(angleToDir)).toEqual(['E', 'SE', 'S', 'SW', 'W', 'NE', 'N', 'NW']);
    expect(angleToDir(22.5)).toBe('E');
    expect(angleToDir(22.6)).toBe('SE');
  });

  it('starts in the middle of the window, idle, not sitting', () => {
    expect(initialNeko(1280, 800, { x: 1, y: 2 })).toMatchObject({
      x: 640,
      y: 400,
      frame: 0,
      tickCount: 0,
      phase: 'idle',
      sitting: false,
      wanderTarget: { x: 1, y: 2 },
      bgPos: '-96px -96px',
    });
  });
});

describe('follow mode', () => {
  it('runs at the pointer 10 px per tick, facing the way it runs', () => {
    const east = nekoFrame(start({ x: 100, y: 100 }), input(0, 600, 100));
    expect(east.x).toBeCloseTo(100 + SPEED);
    expect(east.y).toBeCloseTo(100);
    expect(east.phase).toBe('running');
    expect(sprites('E')).toContain(east.bgPos);
    expect(sprites('SE')).toContain(nekoFrame(start({ x: 100, y: 100 }), input(0, 400, 400)).bgPos);
    expect(sprites('N')).toContain(nekoFrame(start({ x: 100, y: 100 }), input(0, 100, 20)).bgPos);
  });

  it('stops at 48 px: runs from exactly 48 px away, stays put from 47.9 px', () => {
    const at48 = nekoFrame(start({ x: 100, y: 100, phase: 'running' }), input(0, 100 + NEAR, 100));
    expect(at48.phase).toBe('running');
    expect(at48.x).toBeCloseTo(100 + SPEED);
    const inside = nekoFrame(start({ x: 100, y: 100, phase: 'running' }), input(0, 100 + NEAR - 0.1, 100));
    expect(inside.phase).toBe('idle');
    expect(inside.x).toBe(100);
  });

  it('arrives and idles between 38 and 48 px from the pointer', () => {
    let state = start({ x: 100, y: 100 });
    for (let tick = 0; tick < 80 && (tick === 0 || state.phase === 'running'); tick += 1) state = nekoFrame(state, input(0, 600, 300));
    const distance = Math.hypot(state.x - 600, state.y - 300);
    expect(distance).toBeLessThan(NEAR);
    expect(distance).toBeGreaterThanOrEqual(NEAR - SPEED);
    expect(state.phase).toBe('idle');
    expect(state.bgPos).toBe(spritePosition('idle', 0));
  });

  it('gets tired after 10 idle ticks and falls asleep after 15 tired ticks', () => {
    let state = nekoFrame(start({ x: 600, y: 300, phase: 'running' }), input(0, 600, 300));
    expect(state.phase).toBe('idle');
    state = run(state, 10, input(0, 600, 300));
    expect(state.phase).toBe('idle');
    state = nekoFrame(state, input(0, 600, 300));
    expect(state.phase).toBe('tired');
    state = nekoFrame(state, input(0, 600, 300));
    expect(state.bgPos).toBe(spritePosition('tired', 0));
    state = run(state, 14, input(0, 600, 300));
    expect(state.phase).toBe('tired');
    state = nekoFrame(state, input(0, 600, 300));
    expect(state.phase).toBe('sleeping');
    state = nekoFrame(state, input(0, 600, 300));
    expect(sprites('sleeping')).toContain(state.bgPos);
  });

  it('woken from sleep, is alerted for a tick without moving, then runs', () => {
    const alerted = nekoFrame(start({ x: 600, y: 300, phase: 'sleeping' }), input(0, 1000, 300));
    expect(alerted.phase).toBe('alert');
    expect(alerted.bgPos).toBe(spritePosition('alert', 0));
    expect(alerted.x).toBe(600);
    const running = nekoFrame(alerted, input(0, 1000, 300));
    expect(running.phase).toBe('running');
    expect(running.x).toBeCloseTo(600 + SPEED);
  });

  it('alerted with the pointer already near, waits 3 ticks and idles', () => {
    let state = start({ x: 600, y: 300, phase: 'alert', tickCount: 0 });
    state = run(state, 3, input(0, 600, 300));
    expect(state.phase).toBe('alert');
    state = nekoFrame(state, input(0, 600, 300));
    expect(state.phase).toBe('idle');
  });

  it('stays 16 px inside the window', () => {
    const far = run(start({ x: 1200, y: 700 }), 200, input(0, 5000, 5000));
    expect(far.x).toBe(1280 - 16);
    expect(far.y).toBe(800 - 16);
  });
});

describe('flee mode', () => {
  it('runs away at 1.4 × speed, facing away, while the pointer is within 220 px', () => {
    const fled = nekoFrame(start({ x: 600, y: 300 }), input(1, 500, 300));
    expect(fled.x).toBeCloseTo(600 + FLEE_STEP);
    expect(fled.y).toBeCloseTo(300);
    expect(sprites('E')).toContain(fled.bgPos);
  });

  it('idles and stays put when the pointer is more than 220 px away', () => {
    const calm = nekoFrame(start({ x: 600, y: 300 }), input(1, 600 - FLEE_RADIUS - 1, 300));
    expect(calm.x).toBe(600);
    expect(calm.bgPos).toBe(spritePosition('idle', 0));
    expect(nekoFrame(start({ x: 600, y: 300 }), input(1, 600 - FLEE_RADIUS, 300)).x).toBeCloseTo(600 + FLEE_STEP);
  });

  it('is kept 24 px inside the window', () => {
    const cornered = run(start({ x: 1250, y: 780 }), 10, input(1, 1200, 700));
    expect(cornered.x).toBe(1280 - 24);
    expect(cornered.y).toBe(800 - 24);
  });
});

describe('wander mode', () => {
  it('runs to its target, then sits asleep within 48 px and does not move while sitting', () => {
    let state = start({ x: 100, y: 100, wanderTarget: { x: 400, y: 100 } });
    state = nekoFrame(state, input(2, 0, 0));
    expect(state.x).toBeCloseTo(100 + SPEED);
    expect(state.phase).toBe('running');
    while (!state.sitting) state = nekoFrame(state, input(2, 0, 0));
    expect(Math.abs(400 - state.x)).toBeLessThan(NEAR);
    expect(state.phase).toBe('sleeping');
    expect(state.bgPos).toBe(spritePosition('sleeping', 0));
    const still = run(state, 30, input(2, 0, 0));
    expect(still.x).toBe(state.x);
    expect(still.bgPos).toBe(state.bgPos);
  });

  it('ends a sit by taking the next target and running', () => {
    const next = endSit(start({ sitting: true, phase: 'sleeping' }), { x: 10, y: 20 });
    expect(next).toMatchObject({ sitting: false, phase: 'running', wanderTarget: { x: 10, y: 20 } });
  });

  it('sits for 2 to 3 seconds', () => {
    expect(sitMs(() => 0)).toBe(2000);
    expect(sitMs(() => 0.999)).toBeCloseTo(2999);
  });

  it('picks the centre of a random fully visible element', () => {
    const boxes = [box(10, 10, 100, 20), box(-5, 50, 100, 20), box(200, 790, 50, 20), box(300, 300, 0, 10), box(500, 400, 60, 40)];
    expect(pickWanderTarget(boxes, 1280, 800, () => 0)).toEqual({ x: 60, y: 20 });
    expect(pickWanderTarget(boxes, 1280, 800, () => 0.99)).toEqual({ x: 530, y: 420 });
  });

  it('with nothing visible, picks a point at least 80 px inside the window', () => {
    expect(pickWanderTarget([], 1280, 800, () => 0)).toEqual({ x: 80, y: 80 });
    expect(pickWanderTarget([box(-10, 0, 5, 5)], 1280, 800, () => 1)).toEqual({ x: 1200, y: 720 });
  });
});

describe('mode changes (clicking the cat)', () => {
  it('cycles follow → flee → wander → follow', () => {
    expect([nextMode(0), nextMode(1), nextMode(2)]).toEqual([1, 2, 0]);
  });

  it('to wander: drops a sit and takes a new target', () => {
    const next = changeMode(start({ sitting: true, phase: 'sleeping' }), 2, { x: 5, y: 6 });
    expect(next).toMatchObject({ sitting: false, wanderTarget: { x: 5, y: 6 }, phase: 'sleeping' });
  });

  it('to follow or flee: drops a sit and wakes the cat', () => {
    for (const mode of [0, 1] as const) {
      const next = changeMode(start({ sitting: true, phase: 'sleeping', tickCount: 9 }), mode, { x: 5, y: 6 });
      expect(next).toMatchObject({ sitting: false, phase: 'idle', tickCount: 0, wanderTarget: { x: 900, y: 200 } });
    }
  });
});

it('returns a new state and leaves the old one alone', () => {
  const state = start();
  const copy = structuredClone(state);
  for (const mode of [0, 1, 2] as const) expect(nekoFrame(state, input(mode, 100, 100))).not.toBe(state);
  expect(state).toEqual(copy);
});
