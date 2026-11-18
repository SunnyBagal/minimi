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

/** One result set as the popover loaded it from /api/evals. */
export type LoadedSet =
  { kind: 'ready'; summary: EvalSummary } | { kind: 'missing'; message: string } | { kind: 'error'; message: string };

/** Whether two summaries describe the same run: same commit, counts, case lists and spend. */
export function sameRun(a: EvalSummary, b: EvalSummary): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface HeldoutView {
  /** First run: "15/19", or "—". */
  firstTile: string;
  firstShare: number | null;
  /** Why the first-run figure is "—". */
  firstReason: string | null;
  /** After fixes: the latest held-out run, but only once it differs from the first run. */
  afterTile: string;
  afterShare: number | null;
  afterReason: string | null;
  /** The slider: the first-run pass rate. */
  sliderText: string;
  caption: string;
  /** One square per case of the latest held-out run, and a line saying which run that is. */
  cells: CaseCell[];
  cellsLabel: string;
  cellsSummary: string;
}

const tileOf = (summary: EvalSummary) => `${summary.passAtAll.length}/${summary.cases}`;
const shareOf = (summary: EvalSummary) => (summary.cases === 0 ? null : summary.passAtAll.length / summary.cases);

/**
 * The held-out section from the two held-out files: heldout-first.json (the first run,
 * before any fix: the honest number) and heldout.json (the latest run). "After fixes"
 * stays "—" while the latest run is the first run.
 */
export function heldoutView(first: LoadedSet, latest: LoadedSet): HeldoutView {
  let firstTile = '—';
  let firstShare: number | null = null;
  let firstReason: string | null = null;
  let sliderText = '—';
  let caption: string;
  if (first.kind === 'ready' && first.summary.cases > 0) {
    const s = first.summary;
    firstTile = tileOf(s);
    firstShare = shareOf(s);
    sliderText = `${s.passAtAll.length} / ${s.cases}`;
    caption = `${s.passAtAll.length} of ${s.cases} cases passed all ${s.runs} ${s.runs === 1 ? 'run' : 'runs'} on the first run (commit ${s.sha}), before any fix.`;
  } else if (first.kind === 'ready') {
    firstReason = 'no cases';
    caption = 'The first held-out run has no cases, so there is no pass rate.';
  } else {
    firstReason = first.kind === 'missing' ? 'no first-run file' : 'could not load';
    caption = first.message;
  }

  let afterTile = '—';
  let afterShare: number | null = null;
  let afterReason: string | null = null;
  let cells: CaseCell[] = [];
  let cellsLabel: string;
  let cellsSummary = '—';
  if (latest.kind !== 'ready') {
    afterReason = latest.kind === 'missing' ? 'no held-out run file' : 'could not load';
    cellsLabel = latest.message;
  } else {
    const s = latest.summary;
    cells = suiteView(s).cells;
    cellsSummary = `${s.passAtAll.length} pass · ${s.flaky.length} flaky · ${s.failing.length} fail`;
    if (first.kind !== 'ready') {
      afterReason = 'no first run to compare';
      cellsLabel = `Latest held-out run (commit ${s.sha}), one square per case`;
    } else if (sameRun(first.summary, s)) {
      afterReason = 'no run after fixes yet';
      cellsLabel = `Latest held-out run, which is still the first run (commit ${s.sha})`;
    } else if (s.cases === 0) {
      afterReason = 'no cases';
      cellsLabel = 'The latest held-out run has no cases.';
    } else {
      afterTile = tileOf(s);
      afterShare = shareOf(s);
      cellsLabel = `Latest held-out run, after fixes (commit ${s.sha})`;
    }
  }

  return {
    firstTile,
    firstShare,
    firstReason,
    afterTile,
    afterShare,
    afterReason,
    sliderText,
    caption,
    cells,
    cellsLabel,
    cellsSummary,
  };
}
