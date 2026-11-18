/**
 * Eval runner. `npm run evals -- --selftest` proves the harness with no network.
 * A full run of all 19 cases writes `latest.json`. A partial run does not.
 * It does not round 2 of 3 up.
 *
 * Usage:
 *   npm run evals -- --selftest
 *   npm run evals
 *   npm run evals -- --runs 3
 *   npm run evals -- --case 17 --runs 3
 *   npm run evals -- --cases 1,2,3
 *   npm run evals:quick
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemClock } from '../src/core/systemClock';
import { CASES, caseById } from './cases/index';
import { runHarness } from './harness';
import type { JudgeAnswer } from './judge';
import { classify, literalPass } from './score';
import type { Assertion } from './types';

const repoResultsDir = join(dirname(fileURLToPath(import.meta.url)), 'results');

interface RunRecord {
  run: number;
  passed: boolean;
  assertions: Assertion[];
  judge: JudgeAnswer[] | null;
}

interface CaseRecord {
  id: number;
  runs: number;
  passedRuns: number;
  results: RunRecord[];
}

export interface ExecuteOptions {
  /**
   * Where the results JSON is written. The test runner passes a temp directory
   * so a gate run never touches `evals/results/` in the repo.
   */
  resultsDir?: string;
}

export interface ExecuteResult {
  exitCode: number;
  stdout: string;
  networkCalls: number;
  /** The stamp file or `quick.json` this call wrote, or null when it exited before writing. */
  resultsFile: string | null;
}

/** Cases 1–3 are the brief's prompts. 17 is the chat case. 4 is the empty-store no-record case. */
export const QUICK_IDS: readonly number[] = [1, 2, 3, 17, 4];

export interface EvalSelection {
  selftest: boolean;
  quick: boolean;
  runs: number;
  ids: number[];
  error: string | null;
}

function readFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function loadKey(): string {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  return process.env.ANTHROPIC_API_KEY ?? '';
}

function summaryLine(passAtAll: number, flaky: number, failing: number): string {
  return `passAtAll ${passAtAll} flaky ${flaky} failing ${failing}`;
}

/** The commit the run is scoring. `systemClock` is not involved. */
function headSha(): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function fail(exitCode: number, networkCalls: number): ExecuteResult {
  return { exitCode, stdout: '', networkCalls, resultsFile: null };
}

function allIds(): number[] {
  return CASES.map((item) => item.id);
}

function parseIdList(text: string): number[] {
  return text.split(',').map((part) => Number(part.trim()));
}

/** Reads `--runs`, `--case`, `--cases`, `--quick` and `--selftest`. Default runs is 1. */
export function parseEvalArgs(argv: string[]): EvalSelection {
  const selftest = argv.includes('--selftest');
  const quick = argv.includes('--quick');
  const caseFlag = readFlag(argv, '--case');
  const casesFlag = readFlag(argv, '--cases');
  const runsFlag = readFlag(argv, '--runs');
  const runs = runsFlag === undefined ? 1 : Number(runsFlag);
  if (!Number.isInteger(runs) || runs < 1) {
    return { selftest, quick, runs: 0, ids: [], error: 'evals: --runs must be a positive integer' };
  }
  if (caseFlag !== undefined && casesFlag !== undefined) {
    return { selftest, quick, runs, ids: [], error: 'evals: pass --case or --cases, not both' };
  }

  let ids: number[];
  if (caseFlag !== undefined) ids = [Number(caseFlag)];
  else if (casesFlag !== undefined) ids = parseIdList(casesFlag);
  else if (selftest) ids = [1, 4, 17];
  else if (quick) ids = [...QUICK_IDS];
  else ids = allIds();

  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || caseById(id) === undefined)) {
    return { selftest, quick, runs, ids: [], error: 'evals: --case must be an integer from 1 to 19' };
  }
  return { selftest, quick, runs, ids, error: null };
}

/** `latest.json` is replaced only by a live run of every case. Quick and partial runs never write it. */
export function writesLatest(selection: Pick<EvalSelection, 'selftest' | 'quick' | 'ids'>): boolean {
  if (selection.selftest || selection.quick) return false;
  const all = allIds();
  const got = new Set(selection.ids);
  return selection.ids.length === all.length && all.every((id) => got.has(id));
}

/** A quick live run stays in `quick.json`. Every other run keeps a dated stamp. */
export function resultsFileName(
  selection: Pick<EvalSelection, 'selftest' | 'quick'>,
  stamp: string,
): string {
  return selection.quick && !selection.selftest ? 'quick.json' : `${stamp}.json`;
}

export async function execute(argv: string[], options: ExecuteOptions = {}): Promise<ExecuteResult> {
  const sha = headSha();
  const selection = parseEvalArgs(argv);
  if (selection.error !== null) {
    console.error(selection.error);
    return fail(1, 0);
  }
  const { selftest, runs, ids } = selection;

  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  if (selftest) {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      networkCalls += 1;
      throw new Error(`selftest blocked a network call to ${String(input)}`);
    }) as typeof fetch;
  }

  let apiKey = '';
  if (!selftest) {
    apiKey = loadKey();
    if (apiKey === '') {
      console.error('evals: ANTHROPIC_API_KEY is missing');
      return fail(1, 0);
    }
  }

  const records: CaseRecord[] = [];
  try {
    for (const id of ids) {
      const evalCase = caseById(id);
      if (evalCase === undefined) continue;
      const results: RunRecord[] = [];
      for (let run = 1; run <= runs; run += 1) {
        const result = await runHarness(evalCase, { selftest, apiKey });
        results.push({ run, passed: result.passed, assertions: result.assertions, judge: result.judge });
      }
      const passedRuns = results.filter((result) => result.passed).length;
      records.push({ id, runs, passedRuns, results });
      console.error(`evals: case ${id} ${passedRuns}/${runs}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`evals: ${apiKey === '' ? message : message.replaceAll(apiKey, '[redacted]')}`);
    return fail(1, networkCalls);
  } finally {
    if (selftest) globalThis.fetch = originalFetch;
  }

  const totals = classify(records);
  const strict = classify(
    records.map((record) => ({
      id: record.id,
      runs: record.runs,
      passedRuns: record.results.filter((result) => literalPass(result.assertions)).length,
    })),
  );
  const body = {
    mode: selftest ? 'selftest' : 'live',
    sha,
    runs,
    cases: records,
    passAtAll: totals.passAtAll,
    flaky: totals.flaky,
    failing: totals.failing,
    strict,
  };
  const dir = options.resultsDir ?? repoResultsDir;
  mkdirSync(dir, { recursive: true });
  const stamp = systemClock.now().toISOString().replaceAll(':', '-');
  const file = join(dir, resultsFileName(selection, stamp));
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  // latest.json is what a full reading is compared against. A selftest, a
  // quick run, or any run that is not all 19 cases leaves it alone.
  if (writesLatest(selection)) copyFileSync(file, join(dir, 'latest.json'));

  const stdout = summaryLine(totals.passAtAll.length, totals.flaky.length, totals.failing.length);
  if (selftest && networkCalls > 0) return { exitCode: 1, stdout, networkCalls, resultsFile: file };
  return { exitCode: 0, stdout, networkCalls, resultsFile: file };
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  const result = await execute(process.argv.slice(2));
  if (result.stdout !== '') console.log(result.stdout);
  process.exit(result.exitCode);
}
