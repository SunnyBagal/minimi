/**
 * The test-suite summary served by GET /api/evals: read from evals/results/latest.json
 * on the server and cut down to counts and case ids. Traces, assertions, judge notes and
 * answers never leave the server.
 */
import { readFile } from 'node:fs/promises';

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

/** 200 with the summary, 404 when the file is missing, 500 when it cannot be read as results. */
export async function evalsResponse(file: string): Promise<Response> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return Response.json({ error: 'No eval results yet: evals/results/latest.json is missing.' }, { status: 404 });
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
