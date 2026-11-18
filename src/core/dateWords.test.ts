import { describe, expect, it } from 'vitest';
import { dateWords, orList } from './dateWords';

describe('dateWords', () => {
  it('writes a resolved date with a short or long month name and no leading zero', () => {
    expect(dateWords('2026-11-03')).toBe('3 Nov 2026');
    expect(dateWords('2026-11-03', 'long')).toBe('3 November 2026');
    expect(dateWords('2026-03-11', 'long')).toBe('11 March 2026');
  });

  it('returns anything that is not YYYY-MM-DD unchanged', () => {
    expect(dateWords('3/11')).toBe('3/11');
  });
});

describe('orList', () => {
  it('joins with commas and a final "or"', () => {
    expect(orList(['a'])).toBe('a');
    expect(orList(['a', 'b'])).toBe('a or b');
    expect(orList(['a', 'b', 'c'])).toBe('a, b or c');
  });
});
