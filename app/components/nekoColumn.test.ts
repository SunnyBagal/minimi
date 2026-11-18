import { describe, expect, it } from 'vitest';
import { columnBand, insideRect, keepOut, nekoTarget, placeOutside, segmentCrosses, targetOutsideColumn, type Rect } from './nekoColumn';
import { initialNeko, NEKO_EDGE_ARRIVE_PX, nekoFrame, NEKO_SIZE } from './onekoCore';

const VIEW = { width: 1280, height: 800 };
// A 760 px column centred in a 1280 px window, full height: gutters of 260 px.
const COLUMN: Rect = { left: 260, top: 0, right: 1020, bottom: 800 };
const CAT = 32;

/** Whether a cat centred at the point would overlap the column. */
function overlaps(point: { x: number; y: number }, column: Rect, size = CAT): boolean {
  const half = size / 2;
  return point.x + half > column.left && point.x - half < column.right && point.y + half > column.top && point.y - half < column.bottom;
}

describe('targetOutsideColumn (pointer, cat size, column → target outside the column)', () => {
  it('leaves a pointer in the gutter alone', () => {
    expect(targetOutsideColumn({ x: 100, y: 300 }, CAT, COLUMN, VIEW)).toEqual({ x: 100, y: 300 });
    expect(targetOutsideColumn({ x: 1200, y: 50 }, CAT, COLUMN, VIEW)).toEqual({ x: 1200, y: 50 });
  });

  it('moves a pointer over the column to the nearest edge, half a cat outside it', () => {
    expect(targetOutsideColumn({ x: 300, y: 400 }, CAT, COLUMN, VIEW)).toEqual({ x: 244, y: 400 });
    expect(targetOutsideColumn({ x: 1000, y: 120 }, CAT, COLUMN, VIEW)).toEqual({ x: 1036, y: 120 });
  });

  it('counts a pointer in the gutter but within half a cat of the column as over it', () => {
    expect(targetOutsideColumn({ x: 250, y: 400 }, CAT, COLUMN, VIEW)).toEqual({ x: 244, y: 400 });
  });

  it('uses the top or bottom edge of a short column when that is nearer and on screen', () => {
    const short: Rect = { left: 260, top: 200, right: 1020, bottom: 500 };
    expect(targetOutsideColumn({ x: 640, y: 210 }, CAT, short, VIEW)).toEqual({ x: 640, y: 184 });
    expect(targetOutsideColumn({ x: 640, y: 495 }, CAT, short, VIEW)).toEqual({ x: 640, y: 516 });
  });

  it('never returns a point where the cat would overlap the column', () => {
    for (let x = 0; x <= VIEW.width; x += 37) {
      for (let y = 0; y <= VIEW.height; y += 41) {
        const target = targetOutsideColumn({ x, y }, CAT, COLUMN, VIEW);
        expect(target).not.toBeNull();
        if (target !== null) expect(overlaps(target, COLUMN)).toBe(false);
      }
    }
  });

  it('skips an edge where the cat would leave the window', () => {
    const wideLeft: Rect = { left: 10, top: 0, right: 1000, bottom: 800 };
    expect(targetOutsideColumn({ x: 30, y: 400 }, CAT, wideLeft, VIEW)).toEqual({ x: 1016, y: 400 });
  });

  it('returns null when the column fills the window (a phone)', () => {
    const phone = { width: 390, height: 800 };
    const full: Rect = { left: 0, top: 0, right: 390, bottom: 800 };
    expect(targetOutsideColumn({ x: 200, y: 400 }, CAT, full, phone)).toBeNull();
    // 16 px gutters are narrower than the cat.
    expect(targetOutsideColumn({ x: 200, y: 400 }, CAT, { left: 16, top: 0, right: 374, bottom: 800 }, phone)).toBeNull();
  });
});

describe('segmentCrosses', () => {
  const area = keepOut(COLUMN, CAT);
  it('is true for a path through the column and false for one beside or touching it', () => {
    expect(segmentCrosses({ x: 100, y: 300 }, { x: 1200, y: 300 }, area)).toBe(true);
    expect(segmentCrosses({ x: 100, y: 300 }, { x: 200, y: 700 }, area)).toBe(false);
    expect(segmentCrosses({ x: 100, y: 300 }, { x: area.left, y: 300 }, area)).toBe(false);
    expect(segmentCrosses({ x: area.left, y: 0 }, { x: area.left, y: 800 }, area)).toBe(false);
  });
});

describe('nekoTarget', () => {
  it('keeps the cat on its own side when the pointer is in the other gutter', () => {
    expect(nekoTarget({ x: 1200, y: 300 }, { x: 100, y: 500 }, CAT, COLUMN, VIEW)).toEqual({ x: 244, y: 300 });
    expect(nekoTarget({ x: 600, y: 300 }, { x: 1100, y: 500 }, CAT, COLUMN, VIEW)).toEqual({ x: 1036, y: 300 });
  });

  it('follows the pointer in its own gutter', () => {
    expect(nekoTarget({ x: 50, y: 50 }, { x: 100, y: 500 }, CAT, COLUMN, VIEW)).toEqual({ x: 50, y: 50 });
  });

  it('is null when there is no room beside the column', () => {
    expect(nekoTarget({ x: 200, y: 400 }, { x: 200, y: 400 }, CAT, { left: 0, top: 0, right: 390, bottom: 800 }, { width: 390, height: 800 })).toBeNull();
  });

  it('a cat chasing a pointer over the answer is never drawn over the column, and waits at its edge', () => {
    let state = { ...initialNeko(VIEW.width, VIEW.height), x: 60, y: 700 };
    const pointer = { x: 700, y: 300 };
    for (let tick = 0; tick < 200; tick += 1) {
      const target = nekoTarget(pointer, state, NEKO_SIZE, COLUMN, VIEW);
      expect(target).not.toBeNull();
      if (target === null) break;
      const atEdge = target.x !== pointer.x || target.y !== pointer.y;
      state = nekoFrame(state, {
        targetX: target.x,
        targetY: target.y,
        innerWidth: VIEW.width,
        innerHeight: VIEW.height,
        arriveWithin: atEdge ? NEKO_EDGE_ARRIVE_PX : undefined,
      });
      expect(overlaps(state, COLUMN)).toBe(false);
    }
    expect(state.phase).not.toBe('running');
    // Waiting at the edge: the sprite's right side touches the column's left side.
    // (It stops once it is within NEKO_EDGE_ARRIVE_PX of the edge point.)
    expect(Math.hypot(state.x + NEKO_SIZE / 2 - COLUMN.left, state.y - 300)).toBeLessThan(NEKO_EDGE_ARRIVE_PX);
    expect(state.x + NEKO_SIZE / 2).toBeLessThanOrEqual(COLUMN.left);
  });
});

describe('placeOutside and columnBand', () => {
  it('puts a cat found inside the column at the nearest edge', () => {
    const placed = placeOutside({ x: 640, y: 400 }, CAT, COLUMN, VIEW);
    expect(placed).not.toBeNull();
    if (placed !== null) {
      expect(insideRect(placed, keepOut(COLUMN, CAT))).toBe(false);
      expect(overlaps(placed, COLUMN)).toBe(false);
    }
  });

  it('spans the thread and composer horizontally and the whole viewport vertically', () => {
    const thread = { left: 260, top: 60, right: 1020, bottom: 2400 };
    const composer = { left: 250, top: 700, right: 1030, bottom: 780 };
    expect(columnBand([thread, composer], VIEW)).toEqual({ left: 250, top: 0, right: 1030, bottom: 800 });
    expect(columnBand([], VIEW)).toBeNull();
  });
});
