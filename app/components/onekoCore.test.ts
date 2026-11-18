import { describe, expect, it } from 'vitest';
import {
  angleToDir,
  initialNeko,
  NEKO_EDGE_ARRIVE_PX,
  NEKO_IDLE_TICKS,
  NEKO_NEAR_PX,
  NEKO_SPEED,
  NEKO_TIRED_TICKS,
  nekoFrame,
  spritePosition,
  SPRITE_SETS,
  type NekoInput,
  type NekoState,
} from './onekoCore';

const VIEW = { innerWidth: 1280, innerHeight: 800 };

function at(targetX: number, targetY: number): NekoInput {
  return { targetX, targetY, ...VIEW };
}

function run(state: NekoState, ticks: number, input: NekoInput): NekoState {
  let current = state;
  for (let i = 0; i < ticks; i += 1) current = nekoFrame(current, input);
  return current;
}

const sprites = (name: keyof typeof SPRITE_SETS) => SPRITE_SETS[name].map(([x, y]) => `${x * 32}px ${y * 32}px`);

describe('oneko, ported from the portfolio useNeko hook (follow mode)', () => {
  it('keeps the portfolio sprite map and its sheet offsets (32 px cells)', () => {
    expect(Object.keys(SPRITE_SETS)).toEqual(['idle', 'alert', 'tired', 'sleeping', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
    expect(spritePosition('idle', 0)).toBe('-96px -96px');
    expect(spritePosition('alert', 0)).toBe('-224px -96px');
    expect(spritePosition('E', 0)).toBe('-96px 0px');
    expect(spritePosition('E', 1)).toBe('-96px -32px');
    expect(spritePosition('sleeping', 3)).toBe('-64px -32px');
  });

  it('starts in the middle of the viewport, idle', () => {
    expect(initialNeko(1280, 800)).toMatchObject({ x: 640, y: 400, frame: 0, tickCount: 0, phase: 'idle', bgPos: '-96px -96px' });
  });

  it('maps angles to the eight directions as the portfolio does', () => {
    expect(angleToDir(0)).toBe('E');
    expect(angleToDir(45)).toBe('SE');
    expect(angleToDir(90)).toBe('S');
    expect(angleToDir(135)).toBe('SW');
    expect(angleToDir(180)).toBe('W');
    expect(angleToDir(-45)).toBe('NE');
    expect(angleToDir(-90)).toBe('N');
    expect(angleToDir(-135)).toBe('NW');
  });

  it('runs toward the target 10 px per tick, facing the way it runs', () => {
    const start = { ...initialNeko(1280, 800), x: 100, y: 100 };
    const east = nekoFrame(start, at(600, 100));
    expect(east.x).toBeCloseTo(100 + NEKO_SPEED);
    expect(east.y).toBeCloseTo(100);
    expect(east.phase).toBe('running');
    expect(sprites('E')).toContain(east.bgPos);
    expect(sprites('SE')).toContain(nekoFrame(start, at(400, 400)).bgPos);
    expect(sprites('N')).toContain(nekoFrame(start, at(100, 20)).bgPos);
  });

  it('stops within 48 px of the target and idles', () => {
    let arrived = { ...initialNeko(1280, 800), x: 100, y: 100 };
    for (let tick = 0; tick < 80 && (tick === 0 || arrived.phase === 'running'); tick += 1) arrived = nekoFrame(arrived, at(600, 300));
    const distance = Math.hypot(arrived.x - 600, arrived.y - 300);
    expect(distance).toBeLessThan(NEKO_NEAR_PX);
    expect(distance).toBeGreaterThan(NEKO_NEAR_PX - NEKO_SPEED - 0.001);
    expect(arrived.phase).toBe('idle');
    expect(arrived.bgPos).toBe(spritePosition('idle', 0));
  });

  it('gets tired after 10 idle ticks and falls asleep after 15 tired ticks', () => {
    let state = nekoFrame({ ...initialNeko(1280, 800), x: 600, y: 300, phase: 'running' }, at(600, 300));
    expect(state.phase).toBe('idle');
    state = run(state, NEKO_IDLE_TICKS + 1, at(600, 300));
    expect(state.phase).toBe('tired');
    state = nekoFrame(state, at(600, 300));
    expect(state.bgPos).toBe(spritePosition('tired', 0));
    state = run(state, NEKO_TIRED_TICKS, at(600, 300));
    expect(state.phase).toBe('sleeping');
    state = nekoFrame(state, at(600, 300));
    expect(sprites('sleeping')).toContain(state.bgPos);
  });

  it('woken from sleep, is alerted for a tick without moving, then runs', () => {
    const asleep = { ...initialNeko(1280, 800), x: 600, y: 300, phase: 'sleeping' as const };
    const alerted = nekoFrame(asleep, at(1000, 300));
    expect(alerted.phase).toBe('alert');
    expect(alerted.bgPos).toBe(spritePosition('alert', 0));
    expect(alerted.x).toBe(600);
    const running = nekoFrame(alerted, at(1000, 300));
    expect(running.phase).toBe('running');
    expect(running.x).toBeCloseTo(600 + NEKO_SPEED);
  });

  it('with arriveWithin, runs right onto the target, and once resting only wakes 48 px away', () => {
    let state = { ...initialNeko(1280, 800), x: 100, y: 100 };
    const edge = { ...at(300, 100), arriveWithin: NEKO_EDGE_ARRIVE_PX };
    for (let tick = 0; tick < 40 && (tick === 0 || state.phase === 'running'); tick += 1) state = nekoFrame(state, edge);
    expect(state.x).toBeCloseTo(300);
    expect(state.phase).toBe('idle');
    const nudged = nekoFrame(state, { ...at(300, 130), arriveWithin: NEKO_EDGE_ARRIVE_PX });
    expect(nudged.phase).toBe('idle');
    expect(nudged.y).toBe(100);
    expect(nekoFrame(nudged, { ...at(300, 160), arriveWithin: NEKO_EDGE_ARRIVE_PX }).phase).toBe('running');
  });

  it('never steps past the target', () => {
    const near = nekoFrame({ ...initialNeko(1280, 800), x: 100, y: 100 }, at(100 + NEKO_NEAR_PX + 3, 100));
    expect(near.x).toBeCloseTo(100 + NEKO_SPEED);
  });

  it('stays inside the window', () => {
    const far = run({ ...initialNeko(1280, 800), x: 1200, y: 700 }, 200, at(5000, 5000));
    expect(far.x).toBeLessThanOrEqual(VIEW.innerWidth - 16);
    expect(far.y).toBeLessThanOrEqual(VIEW.innerHeight - 16);
  });

  it('returns a new state and leaves the old one alone', () => {
    const state = initialNeko(1280, 800);
    const copy = structuredClone(state);
    expect(nekoFrame(state, at(100, 100))).not.toBe(state);
    expect(state).toEqual(copy);
  });
});
