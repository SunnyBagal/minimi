/**
 * Decoding and timing for the animated pieces in asciiMagicPieces.ts. Kept apart
 * from the data so code that only needs these functions does not pull the
 * frames into its bundle.
 */

export interface AsciiPiece {
  slug: string;
  name: string;
  url: string;
  cols: number;
  rows: number;
  /** The piece's own frame rate. */
  fps: number;
  /** Every stride-th frame is kept; playback runs at fps / stride. */
  stride: number;
  /** Frames in one loop at the piece's fps, before the stride. */
  loopFrames: number;
  /** Each distinct row, once. */
  lines: string[];
  /** Per frame: two ALPHABET characters per row, the row's index into `lines`. */
  frames: string[];
}

export const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';

/** Frame `index` (wrapping) as text: `rows` lines of `cols` characters joined by newlines. */
export function decodeFrame(piece: AsciiPiece, index: number): string {
  const count = piece.frames.length;
  const code = piece.frames[((index % count) + count) % count] ?? '';
  const rows: string[] = [];
  for (let at = 0; at + 1 < code.length; at += 2) {
    const n = ALPHABET.indexOf(code[at] as string) * 64 + ALPHABET.indexOf(code[at + 1] as string);
    rows.push(piece.lines[n] ?? '');
  }
  return rows.join('\n');
}

/** The kept frame shown at `tMs` of playback, at the piece's real speed. */
export function frameIndexAt(piece: AsciiPiece, tMs: number): number {
  const msPerFrame = (1000 * piece.stride) / piece.fps;
  return Math.floor(Math.max(0, tMs) / msPerFrame) % piece.frames.length;
}
