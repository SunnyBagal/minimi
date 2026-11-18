import { describe, expect, it } from 'vitest';
import { initialNeko, NEKO_SPEED, nekoFrame, restoreNeko, spritePosition, SPRITE_SETS, type NekoInput, type NekoState } from './onekoCore';

const VIEW = { innerWidth: 1280, innerHeight: 800 };
const never = () => 0.5; // Math.floor(0.5 * 200) is 100, never 0: no idle animation starts
const always = () => 0; // Math.floor(0 * 200) is 0: an idle animation starts, the first one listed

function input(mousePosX: number, mousePosY: number, random = never): NekoInput {
  return { mousePosX, mousePosY, random, ...VIEW };
}

function run(state: NekoState, frames: number, at: NekoInput): NekoState {
  let current = state;
  for (let i = 0; i < frames; i += 1) current = nekoFrame(current, at);
  return current;
}

describe('oneko port', () => {
  it('keeps the original sprite sheet offsets (32 px cells)', () => {
    expect(spritePosition('idle', 0)).toBe('-96px -96px');
    expect(spritePosition('alert', 0)).toBe('-224px -96px');
    expect(spritePosition('E', 0)).toBe('-96px 0px');
    expect(spritePosition('E', 1)).toBe('-96px -32px');
    expect(spritePosition('scratchSelf', 4)).toBe('-192px 0px');
    expect(Object.keys(SPRITE_SETS)).toHaveLength(17); // as in oneko.js
  });

  it('starts at (32, 32) facing idle', () => {
    expect(initialNeko()).toMatchObject({ nekoPosX: 32, nekoPosY: 32, frameCount: 0, idleTime: 0, bgPos: '-96px -96px' });
  });

  it('chases the pointer 10 px per frame, facing the way it runs', () => {
    const start = { ...initialNeko(), nekoPosX: 100, nekoPosY: 100 };
    const next = nekoFrame(start, input(600, 100));
    expect(next.nekoPosX).toBeCloseTo(100 + NEKO_SPEED);
    expect(next.nekoPosY).toBeCloseTo(100);
    expect(SPRITE_SETS.E.map(([x, y]) => `${x * 32}px ${y * 32}px`)).toContain(next.bgPos);
    const diagonal = nekoFrame(start, input(400, 400));
    expect(SPRITE_SETS.SE.map(([x, y]) => `${x * 32}px ${y * 32}px`)).toContain(diagonal.bgPos);
    const north = nekoFrame(start, input(100, 20));
    expect(SPRITE_SETS.N.map(([x, y]) => `${x * 32}px ${y * 32}px`)).toContain(north.bgPos);
  });

  it('stops within 48 px of the pointer and idles', () => {
    const arrived = run({ ...initialNeko(), nekoPosX: 100, nekoPosY: 100 }, 80, input(600, 300));
    const distance = Math.hypot(arrived.nekoPosX - 600, arrived.nekoPosY - 300);
    expect(distance).toBeLessThan(48);
    expect(distance).toBeGreaterThan(48 - NEKO_SPEED - 0.001);
    expect(arrived.bgPos).toBe(spritePosition('idle', 0));
  });

  it('is alerted before it runs again after idling, counting down from at most 7', () => {
    const idled = run({ ...initialNeko(), nekoPosX: 600, nekoPosY: 300 }, 20, input(600, 300));
    expect(idled.idleTime).toBe(20);
    const alerted = nekoFrame(idled, input(1000, 300));
    expect(alerted.bgPos).toBe(spritePosition('alert', 0));
    expect(alerted.idleTime).toBe(6);
    expect(alerted.nekoPosX).toBe(600); // does not move while alerted
    const moving = run(alerted, 5, input(1000, 300));
    expect(moving.idleTime).toBe(1);
    expect(nekoFrame(moving, input(1000, 300)).nekoPosX).toBeGreaterThan(600);
  });

  it('falls asleep: tired for 8 frames, then the two sleeping sprites', () => {
    let state = run({ ...initialNeko(), nekoPosX: 600, nekoPosY: 300 }, 11, input(600, 300));
    state = nekoFrame(state, input(600, 300, always));
    expect(state.idleAnimation).toBe('sleeping');
    expect(state.bgPos).toBe(spritePosition('tired', 0));
    state = run(state, 8, input(600, 300));
    expect(state.bgPos).toBe(spritePosition('sleeping', 2));
    state = run(state, 4, input(600, 300));
    expect(state.bgPos).toBe(spritePosition('sleeping', 3));
    // The sleep ends after 192 frames.
    state = run(state, 200, input(600, 300));
    expect(state.idleAnimation).toBeNull();
  });

  it('can scratch itself or, at an edge, the wall', () => {
    const scratching = nekoFrame(
      run({ ...initialNeko(), nekoPosX: 600, nekoPosY: 300 }, 11, input(600, 300)),
      input(600, 300, (() => {
        const values = [0, 0.99];
        return () => values.shift() ?? 0.5;
      })()),
    );
    expect(scratching.idleAnimation).toBe('scratchSelf');
    const atWall = nekoFrame(
      run({ ...initialNeko(), nekoPosX: 20, nekoPosY: 300 }, 11, input(20, 300)),
      input(20, 300, (() => {
        const values = [0, 0.99];
        return () => values.shift() ?? 0.5;
      })()),
    );
    expect(atWall.idleAnimation).toBe('scratchWallW');
  });

  it('stays inside the window', () => {
    const far = run({ ...initialNeko(), nekoPosX: 1200, nekoPosY: 700 }, 200, input(5000, 5000));
    expect(far.nekoPosX).toBeLessThanOrEqual(VIEW.innerWidth - 16);
    expect(far.nekoPosY).toBeLessThanOrEqual(VIEW.innerHeight - 16);
  });

  it('returns a new state and leaves the old one alone', () => {
    const state = initialNeko();
    const copy = structuredClone(state);
    expect(nekoFrame(state, input(600, 600))).not.toBe(state);
    expect(state).toEqual(copy);
  });

  it('restores a saved state and rejects junk', () => {
    const saved = JSON.stringify({ ...initialNeko(), nekoPosX: 200, idleAnimation: 'sleeping', mousePosX: 1, mousePosY: 2 });
    expect(restoreNeko(saved)).toMatchObject({ nekoPosX: 200, idleAnimation: 'sleeping' });
    expect(restoreNeko(null)).toBeNull();
    expect(restoreNeko('not json')).toBeNull();
    expect(restoreNeko('{"nekoPosX":"x"}')).toBeNull();
    expect(restoreNeko(JSON.stringify({ ...initialNeko(), bgPos: 'url(javascript:x)' }))?.bgPos).toBe('-96px -96px');
  });
});
