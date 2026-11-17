/**
 * Eval runner. `npm run evals -- --selftest` proves the harness with no network.
 * A full run writes results and prints the totals. It does not round 2 of 3 up.
 *
 * Usage:
 *   npm run evals -- --selftest
 *   npm run evals -- --case 17 --runs 3
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemClock } from '../src/core/systemClock';
import { CASES, caseById } from './cases/index';
import { runHarness } from './harness';
import type { JudgeAnswer } from './judge';
import { classify } from './score';
import type { Assertion } from './types';

const resultsDir = join(dirname(fileURLToPath(import.meta.url)), 'results');

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

export interface ExecuteResult {
  exitCode: number;
  stdout: string;
  networkCalls: number;
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

export async function execute(argv: string[]): Promise<ExecuteResult> {
  const selftest = argv.includes('--selftest');
  const caseFlag = readFlag(argv, '--case');
  const runsFlag = readFlag(argv, '--runs');
  const runs = runsFlag === undefined ? (selftest ? 1 : 3) : Number(runsFlag);
  if (!Number.isInteger(runs) || runs < 1) {
    console.error('evals: --runs must be a positive integer');
    return { exitCode: 1, stdout: '', networkCalls: 0 };
  }

  // Selftest always runs cases 1, 4 and 17. That is the plumbing set.
  const ids = selftest ? [1, 4, 17] : caseFlag === undefined ? CASES.map((item) => item.id) : [Number(caseFlag)];
  if (ids.some((id) => !Number.isInteger(id) || caseById(id) === undefined)) {
    console.error('evals: --case must be an integer from 1 to 19');
    return { exitCode: 1, stdout: '', networkCalls: 0 };
  }

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
      return { exitCode: 1, stdout: '', networkCalls: 0 };
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
      records.push({
        id,
        runs,
        passedRuns: results.filter((result) => result.passed).length,
        results,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`evals: ${apiKey === '' ? message : message.replaceAll(apiKey, '[redacted]')}`);
    return { exitCode: 1, stdout: '', networkCalls };
  } finally {
    if (selftest) globalThis.fetch = originalFetch;
  }

  const totals = classify(records);
  const body = {
    mode: selftest ? 'selftest' : 'live',
    runs,
    cases: records,
    passAtAll: totals.passAtAll,
    flaky: totals.flaky,
    failing: totals.failing,
  };
  mkdirSync(resultsDir, { recursive: true });
  const stamp = systemClock.now().toISOString().replaceAll(':', '-');
  const file = join(resultsDir, `${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  copyFileSync(file, join(resultsDir, 'latest.json'));

  const stdout = summaryLine(totals.passAtAll.length, totals.flaky.length, totals.failing.length);
  if (selftest && networkCalls > 0) return { exitCode: 1, stdout, networkCalls };
  return { exitCode: 0, stdout, networkCalls };
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  const result = await execute(process.argv.slice(2));
  if (result.stdout !== '') console.log(result.stdout);
  process.exit(result.exitCode);
}
