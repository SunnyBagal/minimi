import { describe, expect, it } from 'vitest';
import { classify } from './score';

describe('score', () => {
  it('puts two passing runs and one failing run under flaky, not under passing', () => {
    const totals = classify([
      { id: 2, runs: 3, passedRuns: 2 },
      { id: 17, runs: 3, passedRuns: 3 },
      { id: 4, runs: 3, passedRuns: 0 },
    ]);
    expect(totals.flaky).toEqual([2]);
    expect(totals.passAtAll).toEqual([17]);
    expect(totals.passAtAll).not.toContain(2);
    expect(totals.failing).toEqual([4]);
  });
});
