import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CAT_AT_THE_KEYBOARD, SLEEPING_CAT } from './asciiMagicPieces';
import { decodeFrame, frameIndexAt, type AsciiPiece } from './pieceFrames';

/**
 * The frame each page serves as static HTML (at its data-t0 of 0.5 s), as a
 * SHA-256 of its text. Taken from https://www.ascii-magic.com/ascii/<slug> on
 * 2026-11-18; the stored frame at the same time must be that exact text.
 */
const PUBLISHED_T0: Record<string, { t0: number; sha256: string }> = {
  'sleeping-cat': { t0: 0.5, sha256: '5788172d0e2055c003382bf7092c212d5afc2a22fd9bb3da0e97d886de58b05a' },
  'laptop-typing-cat': { t0: 0.5, sha256: '0ac15020c817a64c1acc757820cfa43dc26d2ff1f62ca92708adec535eec529a' },
};

describe.each([
  ['Sleeping Cat', SLEEPING_CAT],
  ['Cat at the Keyboard', CAT_AT_THE_KEYBOARD],
] as [string, AsciiPiece][])('%s', (name, piece) => {
  it('is the named piece from ascii-magic.com', () => {
    expect(piece.name).toBe(name);
    expect(piece.url).toBe(`https://www.ascii-magic.com/ascii/${piece.slug}`);
  });

  it('decodes every frame to rows lines of exactly cols characters', () => {
    for (let index = 0; index < piece.frames.length; index += 1) {
      const lines = decodeFrame(piece, index).split('\n');
      expect(lines).toHaveLength(piece.rows);
      for (const line of lines) expect([...line]).toHaveLength(piece.cols);
    }
  });

  it('keeps every stride-th frame of one loop', () => {
    expect(piece.frames).toHaveLength(Math.ceil(piece.loopFrames / piece.stride));
  });

  it("the frame at the page's t0 is exactly the frame the page publishes", () => {
    const published = PUBLISHED_T0[piece.slug];
    expect(published).toBeDefined();
    const index = Math.round(((published?.t0 ?? 0) * piece.fps) / piece.stride);
    const text = decodeFrame(piece, index);
    expect(createHash('sha256').update(text).digest('hex')).toBe(published?.sha256);
  });

  it('animates: frames differ over a second', () => {
    const frames = new Set(Array.from({ length: piece.fps }, (_, index) => decodeFrame(piece, index)));
    expect(frames.size).toBeGreaterThan(1);
  });
});

describe('frameIndexAt', () => {
  it('plays at the real speed and wraps at the end of the loop', () => {
    const msPerFrame = (1000 * SLEEPING_CAT.stride) / SLEEPING_CAT.fps;
    expect(frameIndexAt(SLEEPING_CAT, 0)).toBe(0);
    expect(frameIndexAt(SLEEPING_CAT, msPerFrame * 3 + 1)).toBe(3);
    expect(frameIndexAt(SLEEPING_CAT, msPerFrame * SLEEPING_CAT.frames.length)).toBe(0);
    expect(frameIndexAt(SLEEPING_CAT, -50)).toBe(0);
  });

  it('decodeFrame wraps negative and large indices', () => {
    expect(decodeFrame(SLEEPING_CAT, -1)).toBe(decodeFrame(SLEEPING_CAT, SLEEPING_CAT.frames.length - 1));
    expect(decodeFrame(SLEEPING_CAT, SLEEPING_CAT.frames.length)).toBe(decodeFrame(SLEEPING_CAT, 0));
  });
});
