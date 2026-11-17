/**
 * A case passes only when every run passed. Two passes out of three stay
 * flaky. They are never counted as passing.
 */
export interface CaseTally {
  id: number;
  runs: number;
  passedRuns: number;
}

export interface ScoreTotals {
  /** Case ids that passed every run. */
  passAtAll: number[];
  /** Case ids with at least one pass and at least one fail. */
  flaky: number[];
  /** Case ids with no passing run. */
  failing: number[];
}

export function classify(cases: readonly CaseTally[]): ScoreTotals {
  const passAtAll: number[] = [];
  const flaky: number[] = [];
  const failing: number[] = [];
  for (const item of cases) {
    if (item.runs > 0 && item.passedRuns === item.runs) passAtAll.push(item.id);
    else if (item.passedRuns === 0) failing.push(item.id);
    else flaky.push(item.id);
  }
  return { passAtAll, flaky, failing };
}
