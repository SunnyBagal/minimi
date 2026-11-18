import { describe, expect, it } from 'vitest';
import type { EvalSummary } from '../api/evals/summary';
import { suiteView, usd } from './suiteEvals';

const SUMMARY: EvalSummary = {
  sha: 'a423aec',
  runs: 3,
  cases: 5,
  passAtAll: [1, 2, 5],
  flaky: [4],
  failing: [3],
  strict: { passAtAll: [5], flaky: [1], failing: [2, 3, 4] },
  incomplete: [],
  spentUsd: 0.357843,
};

describe('suiteView', () => {
  it('counts scored and literal passes out of the cases', () => {
    const view = suiteView(SUMMARY);
    expect(view.scored).toBe(3);
    expect(view.literal).toBe(1);
    expect(view.scoredShare).toBe(0.6);
    expect(view.literalShare).toBe(0.2);
  });

  it('gives one cell per case id, in id order, coloured by status', () => {
    expect(suiteView(SUMMARY).cells).toEqual([
      { id: 1, status: 'pass' },
      { id: 2, status: 'pass' },
      { id: 3, status: 'fail' },
      { id: 4, status: 'flaky' },
      { id: 5, status: 'pass' },
    ]);
    expect(suiteView(SUMMARY).literalCells.map((cell) => cell.status)).toEqual([
      'flaky',
      'fail',
      'fail',
      'fail',
      'pass',
    ]);
  });

  it('marks incomplete cases as incomplete', () => {
    expect(suiteView({ ...SUMMARY, incomplete: [4] }).cells[3]).toEqual({
      id: 4,
      status: 'incomplete',
    });
  });

  it('reads "3 / 5 pass · 3 runs · a423aec"', () => {
    expect(suiteView(SUMMARY).subtitle).toBe('3 / 5 pass · 3 runs · a423aec');
    expect(suiteView({ ...SUMMARY, runs: 1 }).subtitle).toBe('3 / 5 pass · 1 run · a423aec');
  });

  it('an empty suite has null shares, not 0', () => {
    const empty = suiteView({
      ...SUMMARY,
      cases: 0,
      passAtAll: [],
      flaky: [],
      failing: [],
      strict: { passAtAll: [], flaky: [], failing: [] },
    });
    expect(empty.scoredShare).toBeNull();
    expect(empty.literalShare).toBeNull();
    expect(empty.cells).toEqual([]);
  });

  it('formats the metered cost, with "—" when none was recorded', () => {
    expect(usd(0.357843)).toBe('$0.36');
    expect(usd(null)).toBe('—');
  });
});
