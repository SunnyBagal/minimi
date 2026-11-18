import { describe, expect, it } from 'vitest';
import type { EvalSummary } from '../api/evals/summary';
import { heldoutView, sameRun, suiteView, usd, type LoadedSet } from './suiteEvals';

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

  it('shows the rates as text for the slider, tiles and caption', () => {
    const view = suiteView(SUMMARY);
    expect(view.scoredText).toBe('3 / 5');
    expect(view.scoredTile).toBe('3/5');
    expect(view.literalTile).toBe('1/5');
    expect(view.caption).toBe('3 of 5 cases pass all 3 runs as scored.');
    expect(view.emptyReason).toBeNull();
  });

  it('an empty suite shows "—" with a reason everywhere, never 0 / 0', () => {
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
    expect(empty.subtitle).toBe('No cases in the last run · 3 runs · a423aec');
    expect([empty.scoredText, empty.scoredTile, empty.literalTile]).toEqual(['—', '—', '—']);
    expect(empty.caption).toBe('The last results file has no cases, so there is no pass rate.');
    expect(empty.emptyReason).toBe('no cases');
    for (const value of [empty.subtitle, empty.scoredText, empty.scoredTile, empty.literalTile, empty.caption]) {
      expect(value).not.toContain('0 / 0');
      expect(value).not.toContain('0/0');
    }
  });

  it('formats the metered cost, with "—" when none was recorded', () => {
    expect(usd(0.357843)).toBe('$0.36');
    expect(usd(null)).toBe('—');
  });
});

describe('heldoutView', () => {
  const ids = Array.from({ length: 19 }, (_, i) => 101 + i);
  // The real first held-out run: 15 of 19, 111 flaky, 104, 116 and 118 failing.
  const FIRST: EvalSummary = {
    sha: '20e0b11',
    runs: 3,
    cases: 19,
    passAtAll: ids.filter((id) => ![104, 111, 116, 118].includes(id)),
    flaky: [111],
    failing: [104, 116, 118],
    strict: {
      passAtAll: ids.filter((id) => ![104, 111, 116, 118].includes(id)),
      flaky: [111],
      failing: [104, 116, 118],
    },
    incomplete: [],
    spentUsd: 0.1857253,
  };
  const ready = (summary: EvalSummary): LoadedSet => ({ kind: 'ready', summary });
  const AFTER: EvalSummary = {
    ...FIRST,
    sha: '44c4247',
    passAtAll: ids.filter((id) => id !== 116),
    flaky: [],
    failing: [116],
    spentUsd: 0.19,
  };

  it('first run is the honest number: 15/19, on the slider and its tile', () => {
    const view = heldoutView(ready(FIRST), ready(FIRST));
    expect(view.firstTile).toBe('15/19');
    expect(view.firstShare).toBeCloseTo(15 / 19);
    expect(view.sliderText).toBe('15 / 19');
    expect(view.caption).toBe('15 of 19 cases passed all 3 runs on the first run (commit 20e0b11), before any fix.');
  });

  it('after fixes is "—" while heldout.json is still the first run', () => {
    const view = heldoutView(ready(FIRST), ready({ ...FIRST }));
    expect(view.afterTile).toBe('—');
    expect(view.afterShare).toBeNull();
    expect(view.afterReason).toBe('no run after fixes yet');
    expect(view.cells).toHaveLength(19);
    expect(view.cells[0]).toEqual({ id: 101, status: 'pass' });
    expect(view.cells.find((cell) => cell.id === 111)?.status).toBe('flaky');
    expect(view.cellsSummary).toBe('15 pass · 1 flaky · 3 fail');
  });

  it('after fixes shows the latest run once it differs from the first', () => {
    const view = heldoutView(ready(FIRST), ready(AFTER));
    expect(view.afterTile).toBe('18/19');
    expect(view.afterShare).toBeCloseTo(18 / 19);
    expect(view.afterReason).toBeNull();
    expect(view.firstTile).toBe('15/19'); // the first run is not replaced
    expect(view.cellsLabel).toContain('after fixes (commit 44c4247)');
    expect(view.cells.find((cell) => cell.id === 116)?.status).toBe('fail');
  });

  it('a missing file shows "—" with a reason, never a made-up figure', () => {
    const missingFirst = heldoutView(
      { kind: 'missing', message: 'No eval results yet: evals/results/heldout-first.json is missing.' },
      ready(AFTER),
    );
    expect([missingFirst.firstTile, missingFirst.sliderText]).toEqual(['—', '—']);
    expect(missingFirst.firstReason).toBe('no first-run file');
    expect(missingFirst.caption).toContain('heldout-first.json is missing');
    expect(missingFirst.afterTile).toBe('—');
    expect(missingFirst.afterReason).toBe('no first run to compare');

    const missingLatest = heldoutView(ready(FIRST), {
      kind: 'missing',
      message: 'No eval results yet: evals/results/heldout.json is missing.',
    });
    expect(missingLatest.firstTile).toBe('15/19');
    expect(missingLatest.afterTile).toBe('—');
    expect(missingLatest.afterReason).toBe('no held-out run file');
    expect(missingLatest.cells).toEqual([]);
    expect(missingLatest.cellsLabel).toContain('heldout.json is missing');

    const broken = heldoutView({ kind: 'error', message: 'bad' }, { kind: 'error', message: 'bad' });
    expect([broken.firstReason, broken.afterReason]).toEqual(['could not load', 'could not load']);
  });

  it('sameRun compares the whole summary', () => {
    expect(sameRun(FIRST, { ...FIRST })).toBe(true);
    expect(sameRun(FIRST, { ...FIRST, spentUsd: 0.2 })).toBe(false);
    expect(sameRun(FIRST, AFTER)).toBe(false);
  });
});
