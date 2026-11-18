/**
 * "Test suite" figures for the evals popover, computed only from the /api/evals summary.
 */
import type { CaseLists, EvalSummary } from '../api/evals/summary';

export type CaseStatus = 'pass' | 'flaky' | 'fail' | 'incomplete';

export interface CaseCell {
  id: number;
  status: CaseStatus;
}

export interface SuiteView {
  /** Cases that passed every run, scored. */
  scored: number;
  /** Cases that passed every run under the spec's literal check. */
  literal: number;
  cases: number;
  /** scored / cases; null for an empty suite. */
  scoredShare: number | null;
  literalShare: number | null;
  /** One cell per case id, in id order. */
  cells: CaseCell[];
  literalCells: CaseCell[];
  /** "17 / 19 pass · 3 runs · a423aec"; "No cases in the last run · …" for an empty suite. */
  subtitle: string;
  /** "16 / 19", or "—" for an empty suite. */
  scoredText: string;
  /** "16/19" for the tile, or "—". */
  scoredTile: string;
  literalTile: string;
  /** What the slider shows, or why there is nothing to show. */
  caption: string;
  /** Why the rates are "—"; null when they have values. */
  emptyReason: string | null;
}

function cellsOf(lists: CaseLists, incomplete: readonly number[]): CaseCell[] {
  const status = new Map<number, CaseStatus>();
  for (const id of lists.passAtAll) status.set(id, 'pass');
  for (const id of lists.flaky) status.set(id, 'flaky');
  for (const id of lists.failing) status.set(id, 'fail');
  for (const id of incomplete) status.set(id, 'incomplete');
  return [...status.entries()].sort(([a], [b]) => a - b).map(([id, value]) => ({ id, status: value }));
}

export function suiteView(summary: EvalSummary): SuiteView {
  const share = (n: number) => (summary.cases === 0 ? null : n / summary.cases);
  const scored = summary.passAtAll.length;
  const literal = summary.strict.passAtAll.length;
  const runs = `${summary.runs} ${summary.runs === 1 ? 'run' : 'runs'}`;
  if (summary.cases === 0) {
    return {
      scored,
      literal,
      cases: 0,
      scoredShare: null,
      literalShare: null,
      cells: [],
      literalCells: [],
      subtitle: `No cases in the last run · ${runs} · ${summary.sha}`,
      scoredText: '—',
      scoredTile: '—',
      literalTile: '—',
      caption: 'The last results file has no cases, so there is no pass rate.',
      emptyReason: 'no cases',
    };
  }
  return {
    scored,
    literal,
    cases: summary.cases,
    scoredShare: share(scored),
    literalShare: share(literal),
    cells: cellsOf(summary, summary.incomplete),
    literalCells: cellsOf(summary.strict, summary.incomplete),
    subtitle: `${scored} / ${summary.cases} pass · ${runs} · ${summary.sha}`,
    scoredText: `${scored} / ${summary.cases}`,
    scoredTile: `${scored}/${summary.cases}`,
    literalTile: `${literal}/${summary.cases}`,
    caption: `${scored} of ${summary.cases} cases pass all ${runs} as scored.`,
    emptyReason: null,
  };
}

/** "$0.36"; "—" when the run recorded no spend. */
export function usd(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}

export const STATUS_LABEL: Record<CaseStatus, string> = {
  pass: 'passes every run',
  flaky: 'passes some runs',
  fail: 'fails every run',
  incomplete: 'runs incomplete',
};
