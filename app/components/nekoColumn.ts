/**
 * Keeps the oneko cat off the conversation column. Pure geometry, used by Oneko.tsx
 * every tick: the cat's centre must stay outside the column grown by half the cat
 * on every side, so the 32 px sprite is never drawn over the column.
 */

export interface Point {
  x: number;
  y: number;
}

/** A rectangle in viewport pixels, as getBoundingClientRect gives it. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** The area the cat's centre may not enter: the column grown by half the cat. */
export function keepOut(column: Rect, catSize: number): Rect {
  const half = catSize / 2;
  return { left: column.left - half, top: column.top - half, right: column.right + half, bottom: column.bottom + half };
}

/** Strictly inside: a centre on the edge draws the cat touching the column, not over it. */
export function insideRect(point: Point, rect: Rect): boolean {
  return point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom;
}

function fitsViewport(point: Point, catSize: number, viewport: Viewport): boolean {
  const half = catSize / 2;
  return point.x >= half && point.x <= viewport.width - half && point.y >= half && point.y <= viewport.height - half;
}

/**
 * Where the cat should go for this pointer: the pointer itself when a cat drawn there
 * would not overlap the column; otherwise the nearest point on the edge of the
 * keep-out area at which the whole cat is still inside the viewport. Null when there
 * is no such point (the column fills the viewport, as on a phone).
 */
export function targetOutsideColumn(pointer: Point, catSize: number, column: Rect, viewport: Viewport): Point | null {
  const area = keepOut(column, catSize);
  if (!insideRect(pointer, area)) return pointer;
  const half = catSize / 2;
  const x = Math.min(Math.max(pointer.x, half), viewport.width - half);
  const y = Math.min(Math.max(pointer.y, half), viewport.height - half);
  const candidates: Point[] = [
    { x: area.left, y },
    { x: area.right, y },
    { x, y: area.top },
    { x, y: area.bottom },
  ];
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (!fitsViewport(candidate, catSize, viewport)) continue;
    const distance = Math.hypot(candidate.x - pointer.x, candidate.y - pointer.y);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Whether the straight segment from `a` to `b` passes through the inside of `rect` (Liang–Barsky). */
export function segmentCrosses(a: Point, b: Point, rect: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clips: [number, number][] = [
    [-dx, a.x - rect.left],
    [dx, rect.right - a.x],
    [-dy, a.y - rect.top],
    [dy, rect.bottom - a.y],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q <= 0) return false; // parallel to this edge and on or beyond it
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t0) t0 = t;
    } else if (t < t1) {
      t1 = t;
    }
    if (t0 >= t1) return false;
  }
  return t1 - t0 > 0;
}

/**
 * The target for one tick, given where the cat is. The cat never runs across the
 * column: when the straight path to the target would pass through it, the cat goes
 * to the edge on its own side instead, level with the target, and waits there.
 */
export function nekoTarget(pointer: Point, cat: Point, catSize: number, column: Rect, viewport: Viewport): Point | null {
  const target = targetOutsideColumn(pointer, catSize, column, viewport);
  if (target === null) return null;
  const area = keepOut(column, catSize);
  if (!segmentCrosses(cat, target, area)) return target;
  const half = catSize / 2;
  const clampY = (y: number) => Math.min(Math.max(y, half), viewport.height - half);
  const clampX = (x: number) => Math.min(Math.max(x, half), viewport.width - half);
  if (cat.x <= area.left) return { x: area.left, y: clampY(target.y) };
  if (cat.x >= area.right) return { x: area.right, y: clampY(target.y) };
  if (cat.y <= area.top) return { x: clampX(target.x), y: area.top };
  return { x: clampX(target.x), y: area.bottom };
}

/**
 * Where a cat that finds itself inside the keep-out area (at start, or after a
 * resize) is put at once, so it is never drawn over the column. Null: no room.
 */
export function placeOutside(cat: Point, catSize: number, column: Rect, viewport: Viewport): Point | null {
  return targetOutsideColumn(cat, catSize, column, viewport);
}

/**
 * The column as the cat sees it: the horizontal extent of the thread and the composer,
 * from the top of the viewport to the bottom. The thread runs from under the header to
 * the composer, so treating it as a full-height band keeps the cat in a side gutter.
 */
export function columnBand(rects: Rect[], viewport: Viewport): Rect | null {
  const visible = rects.filter((rect) => rect.right > rect.left);
  if (visible.length === 0) return null;
  return {
    left: Math.min(...visible.map((rect) => rect.left)),
    right: Math.max(...visible.map((rect) => rect.right)),
    top: 0,
    bottom: viewport.height,
  };
}
