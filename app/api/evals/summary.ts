/**
 * The test-suite summary served by GET /api/evals: read from evals/results/latest.json
 * on the server and cut down to counts and case ids. Traces, assertions, judge notes and
 * answers never leave the server.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface CaseLists {
  passAtAll: number[];
  flaky: number[];
  failing: number[];
}

export interface EvalSummary extends CaseLists {
  /** The commit the suite ran on, 7 characters. */
  sha: string;
  /** Runs per case. */
  runs: number;
  /** Number of cases. */
  cases: number;
  /** The spec's literal check: the same three lists, scored strictly. */
  strict: CaseLists;
  /** Cases whose runs did not all complete. */
  incomplete: number[];
  /** Metered spend in USD, when the file records it. */
  spentUsd: number | null;
}

const isIdList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((id) => typeof id === 'number' && Number.isInteger(id));

function lists(value: unknown): CaseLists | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isIdList(v.passAtAll) || !isIdList(v.flaky) || !isIdList(v.failing)) return null;
  return {
    passAtAll: [...v.passAtAll],
    flaky: [...v.flaky],
    failing: [...v.failing],
  };
}

/** The summary of a parsed results file, or null when it does not have the expected shape. */
export function summarizeEvals(raw: unknown): EvalSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;
  const scored = lists(v);
  const strict = lists(v.strict);
  if (scored === null || strict === null) return null;
  if (typeof v.sha !== 'string' || v.sha.length < 7) return null;
  if (typeof v.runs !== 'number' || !Array.isArray(v.cases)) return null;
  const spend = typeof v.spend === 'object' && v.spend !== null ? (v.spend as Record<string, unknown>) : null;
  const spentUsd =
    spend !== null && typeof spend.spentUsd === 'number' && Number.isFinite(spend.spentUsd) ? spend.spentUsd : null;
  return {
    sha: v.sha.slice(0, 7),
    runs: v.runs,
    cases: v.cases.length,
    ...scored,
    strict,
    incomplete: isIdList(v.incomplete) ? [...v.incomplete] : [],
    spentUsd,
  };
}

/**
 * The result sets GET /api/evals serves (`?set=`), each a file in evals/results/:
 * the main set (cases 1–19), the held-out set's latest run (cases 101–119), and the
 * held-out set's first run, kept as it was before any fix.
 */
export const EVAL_SETS = {
  main: 'latest.json',
  heldout: 'heldout.json',
  'heldout-first': 'heldout-first.json',
} as const;

export type EvalSet = keyof typeof EVAL_SETS;

/** The set named by `?set=`: main when absent, null when it is not a known set. */
export function evalSetOf(param: string | null): EvalSet | null {
  if (param === null || param === '') return 'main';
  return Object.hasOwn(EVAL_SETS, param) ? (param as EvalSet) : null;
}

/**
 * GET /api/evals?set=…: 400 for an unknown set, otherwise the summary of the file `fileFor`
 * gives for that set. route.ts passes literal paths, so the build traces only those files.
 */
export async function evalsRequest(url: string, fileFor: (set: EvalSet) => string): Promise<Response> {
  const param = new URL(url).searchParams.get('set');
  const set = evalSetOf(param);
  if (set === null) {
    return Response.json(
      { error: `Unknown set "${param}". Use one of: ${Object.keys(EVAL_SETS).join(', ')}.` },
      { status: 400 },
    );
  }
  return evalsResponse(fileFor(set));
}

/** 200 with the summary, 404 when the file is missing, 500 when it cannot be read as results. */
export async function evalsResponse(file: string): Promise<Response> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return Response.json(
        { error: `No eval results yet: evals/results/${path.basename(file)} is missing.` },
        { status: 404 },
      );
    }
    return Response.json({ error: 'The eval results could not be read.' }, { status: 500 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return Response.json({ error: 'The eval results file is not valid JSON.' }, { status: 500 });
  }
  const summary = summarizeEvals(parsed);
  if (summary === null)
    return Response.json({ error: 'The eval results file has an unexpected shape.' }, { status: 500 });
  return Response.json(summary, { headers: { 'Cache-Control': 'no-store' } });
}
