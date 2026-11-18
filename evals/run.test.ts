import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CASES } from './cases/index';
import { execute, parseEvalArgs, QUICK_IDS, resultsFileName, writesFull, writesLatest } from './run';
import type { HarnessResult } from './harness';

const allIds = CASES.map((item) => item.id);
const repoResults = join(dirname(fileURLToPath(import.meta.url)), 'results');
const repoLatest = join(repoResults, 'latest.json');

function tempResults(): string {
  return mkdtempSync(join(tmpdir(), 'minimi-eval-results-'));
}

function repoSnapshot(): { names: string[] | null; latest: string | null } {
  return {
    names: existsSync(repoResults) ? readdirSync(repoResults).sort() : null,
    latest: existsSync(repoLatest) ? readFileSync(repoLatest, 'utf8') : null,
  };
}

describe('parseEvalArgs', () => {
  it('defaults to one run of every case', () => {
    const selection = parseEvalArgs([]);
    expect(selection).toEqual({
      selftest: false,
      quick: false,
      runs: 1,
      ids: allIds,
      budgetUsd: 4.5,
      error: null,
    });
  });

  it('reads --budget-usd and rejects a missing, zero or negative budget', () => {
    expect(parseEvalArgs(['--budget-usd', '2.5'])).toMatchObject({ budgetUsd: 2.5, error: null });
    expect(parseEvalArgs(['--budget-usd']).error).toBe('evals: --budget-usd needs a value');
    expect(parseEvalArgs(['--budget-usd', '0']).error).toBe('evals: --budget-usd must be a positive number');
    expect(parseEvalArgs(['--budget-usd', 'abc']).error).toBe('evals: --budget-usd must be a positive number');
  });

  it('keeps --runs and --case', () => {
    expect(parseEvalArgs(['--runs', '3'])).toMatchObject({ runs: 3, ids: allIds, error: null });
    expect(parseEvalArgs(['--case', '17'])).toMatchObject({ runs: 1, ids: [17], error: null });
    expect(parseEvalArgs(['--case', '17', '--runs', '3'])).toMatchObject({ runs: 3, ids: [17], error: null });
  });

  it('reads a comma list from --cases', () => {
    expect(parseEvalArgs(['--cases', '1,2,3']).ids).toEqual([1, 2, 3]);
    expect(parseEvalArgs(['--cases', '1, 2, 3']).ids).toEqual([1, 2, 3]);
  });

  it('selects the quick five: brief prompts, chat case 17, no-record case 4', () => {
    const selection = parseEvalArgs(['--quick']);
    expect(selection.quick).toBe(true);
    expect(selection.runs).toBe(1);
    expect(selection.ids).toEqual([...QUICK_IDS]);
    expect(selection.ids).toEqual([1, 2, 3, 17, 4]);
  });

  it('keeps the selftest trio unless a case flag is set', () => {
    expect(parseEvalArgs(['--selftest'])).toMatchObject({ runs: 1, ids: [1, 4, 17], error: null });
    expect(parseEvalArgs(['--selftest', '--case', '17']).ids).toEqual([17]);
  });

  it('rejects a bad run count, an unknown id, and both case flags', () => {
    expect(parseEvalArgs(['--runs', '0']).error).toBe('evals: --runs must be a positive integer');
    expect(parseEvalArgs(['--runs', 'x']).error).toBe('evals: --runs must be a positive integer');
    expect(parseEvalArgs(['--cases', '1,99']).error).toBe('evals: --case must be an integer from 1 to 19');
    expect(parseEvalArgs(['--case', '1', '--cases', '2']).error).toBe('evals: pass --case or --cases, not both');
  });

  it('rejects a flag with no value', () => {
    expect(parseEvalArgs(['--case']).error).toBe('evals: --case needs a value');
    expect(parseEvalArgs(['--cases']).error).toBe('evals: --cases needs a value');
    expect(parseEvalArgs(['--runs']).error).toBe('evals: --runs needs a value');
    expect(parseEvalArgs(['--case', '--runs', '3']).error).toBe('evals: --case needs a value');
  });

  it('rejects a case listed more than once', () => {
    expect(parseEvalArgs(['--cases', '1,1']).error).toBe('evals: --cases lists a case more than once');
    expect(parseEvalArgs(['--cases', '1, 2, 1']).error).toBe('evals: --cases lists a case more than once');
  });

  it('rejects --quick combined with --case, --cases or --runs', () => {
    const error = 'evals: --quick does not take --case, --cases or --runs';
    expect(parseEvalArgs(['--quick', '--case', '17']).error).toBe(error);
    expect(parseEvalArgs(['--quick', '--cases', '1,2']).error).toBe(error);
    expect(parseEvalArgs(['--quick', '--runs', '3']).error).toBe(error);
  });
});

describe('writesLatest', () => {
  const live = { selftest: false, quick: false };

  it('is true only for a live run of every case with at least 3 runs', () => {
    expect(writesLatest({ ...live, runs: 3, ids: allIds })).toBe(true);
    expect(writesLatest({ ...live, runs: 4, ids: allIds })).toBe(true);
    expect(writesLatest({ ...live, runs: 1, ids: allIds })).toBe(false);
    expect(writesLatest({ ...live, runs: 3, ids: [17] })).toBe(false);
    expect(writesLatest({ selftest: false, quick: true, runs: 3, ids: allIds })).toBe(false);
    expect(writesLatest({ selftest: true, quick: false, runs: 3, ids: allIds })).toBe(false);
    const missingOne = [2, ...allIds.slice(1)];
    expect(missingOne).toHaveLength(allIds.length);
    expect(writesLatest({ ...live, runs: 3, ids: missingOne })).toBe(false);
    expect(writesLatest({ ...live, runs: 3, ids: [...allIds, 1] })).toBe(false);
  });
});

describe('writesFull', () => {
  it('is a live run of every case with fewer than 3 runs', () => {
    expect(writesFull({ selftest: false, quick: false, runs: 1, ids: allIds })).toBe(true);
    expect(writesFull({ selftest: false, quick: false, runs: 2, ids: allIds })).toBe(true);
    expect(writesFull({ selftest: false, quick: false, runs: 3, ids: allIds })).toBe(false);
    expect(writesFull({ selftest: false, quick: false, runs: 1, ids: [17] })).toBe(false);
  });
});

describe('resultsFileName', () => {
  it('sends a quick live run to quick.json and every other run to a stamp', () => {
    expect(resultsFileName({ selftest: false, quick: true }, '2026-11-18T00-00-00.000Z')).toBe('quick.json');
    expect(resultsFileName({ selftest: true, quick: true }, 'stamp')).toBe('stamp.json');
    expect(resultsFileName({ selftest: false, quick: false }, 'stamp')).toBe('stamp.json');
  });
});

function stubHarness(): { runHarness: typeof import('./harness').runHarness; calls: () => number } {
  let calls = 0;
  const passed: HarnessResult = { assertions: [], judge: null, passed: true };
  return {
    calls: () => calls,
    runHarness: async () => {
      calls += 1;
      return passed;
    },
  };
}

describe('partial run', () => {
  it('a live partial run leaves latest.json alone and makes no network call', async () => {
    const before = repoSnapshot();
    const dir = tempResults();
    const sentinel = '{"mode":"live","keep":true}\n';
    writeFileSync(join(dir, 'latest.json'), sentinel);
    const stub = stubHarness();

    const result = await execute(['--case', '17'], { resultsDir: dir, runHarness: stub.runHarness });

    expect(stub.calls()).toBe(1);
    expect(result.networkCalls).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.resultsFile?.startsWith(dir)).toBe(true);
    expect(basename(result.resultsFile ?? '')).not.toBe('latest.json');
    expect(basename(result.resultsFile ?? '')).not.toBe('quick.json');
    expect(basename(result.resultsFile ?? '')).not.toBe('full.json');
    expect(readFileSync(join(dir, 'latest.json'), 'utf8')).toBe(sentinel);
    expect(existsSync(join(dir, 'quick.json'))).toBe(false);
    expect(existsSync(join(dir, 'full.json'))).toBe(false);
    const written = JSON.parse(readFileSync(result.resultsFile ?? '', 'utf8')) as {
      mode: string;
      runs: number;
      cases: Array<{ id: number }>;
    };
    expect(written.mode).toBe('live');
    expect(written.runs).toBe(1);
    expect(written.cases.map((item) => item.id)).toEqual([17]);
    expect(repoSnapshot()).toEqual(before);
  });

  it('a one-run full pass writes full.json and leaves latest.json', async () => {
    const before = repoSnapshot();
    const dir = tempResults();
    const sentinel = '{"mode":"live","keep":true}\n';
    writeFileSync(join(dir, 'latest.json'), sentinel);
    const stub = stubHarness();

    const result = await execute([], { resultsDir: dir, runHarness: stub.runHarness });

    expect(stub.calls()).toBe(allIds.length);
    expect(result.networkCalls).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(dir, 'latest.json'), 'utf8')).toBe(sentinel);
    expect(existsSync(join(dir, 'quick.json'))).toBe(false);
    const full = readFileSync(join(dir, 'full.json'), 'utf8');
    expect(full).toBe(readFileSync(result.resultsFile ?? '', 'utf8'));
    const written = JSON.parse(full) as { mode: string; runs: number; cases: Array<{ id: number }> };
    expect(written.mode).toBe('live');
    expect(written.runs).toBe(1);
    expect(written.cases.map((item) => item.id)).toEqual(allIds);
    expect(repoSnapshot()).toEqual(before);
  });

  it('a three-run full pass writes latest.json and not full.json', async () => {
    const before = repoSnapshot();
    const dir = tempResults();
    const stub = stubHarness();

    const result = await execute(['--runs', '3'], { resultsDir: dir, runHarness: stub.runHarness });

    expect(stub.calls()).toBe(allIds.length * 3);
    expect(result.networkCalls).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(dir, 'full.json'))).toBe(false);
    expect(existsSync(join(dir, 'quick.json'))).toBe(false);
    const latest = readFileSync(join(dir, 'latest.json'), 'utf8');
    expect(latest).toBe(readFileSync(result.resultsFile ?? '', 'utf8'));
    const written = JSON.parse(latest) as { mode: string; runs: number };
    expect(written.mode).toBe('live');
    expect(written.runs).toBe(3);
    expect(repoSnapshot()).toEqual(before);
  });

  it('a selftest partial run never overwrites latest.json', async () => {
    const before = repoSnapshot();
    const dir = tempResults();
    const sentinel = '{"mode":"live","keep":true}\n';
    writeFileSync(join(dir, 'latest.json'), sentinel);

    const result = await execute(['--selftest', '--case', '17', '--runs', '1'], { resultsDir: dir });

    expect(result.networkCalls).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.resultsFile?.startsWith(dir)).toBe(true);
    expect(basename(result.resultsFile ?? '')).not.toBe('latest.json');
    expect(basename(result.resultsFile ?? '')).not.toBe('quick.json');
    expect(readFileSync(join(dir, 'latest.json'), 'utf8')).toBe(sentinel);
    const written = JSON.parse(readFileSync(result.resultsFile ?? '', 'utf8')) as {
      mode: string;
      runs: number;
      cases: Array<{ id: number }>;
    };
    expect(written.mode).toBe('selftest');
    expect(written.runs).toBe(1);
    expect(written.cases.map((item) => item.id)).toEqual([17]);
    expect(existsSync(join(dir, 'quick.json'))).toBe(false);
    expect(repoSnapshot()).toEqual(before);
  });
});

describe('budget', () => {
  type Harness = typeof import('./harness').runHarness;

  /**
   * A harness whose case-runs each make one metered Sonnet call. `plan` gives,
   * per case id, the usage the fake API reports and the request's max_tokens.
   * A refused request is caught, as the pipeline would catch it, and the run
   * still reports a pass: the runner must not score it.
   */
  function meteredHarness(plan: (id: number) => { input: number; output: number; maxTokens: number }): {
    runHarness: Harness;
    calls: () => number;
    baseFetch: typeof fetch;
  } {
    let calls = 0;
    let current = 0;
    const baseFetch = (async () => {
      const step = plan(current);
      return new Response(
        JSON.stringify({ model: 'claude-sonnet-5-5', usage: { input_tokens: step.input, output_tokens: step.output } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const runHarness: Harness = async (evalCase, options) => {
      calls += 1;
      current = evalCase.id;
      try {
        const step = plan(evalCase.id);
        // The body is padded to the input size the fake API will report, so usage stays within the reservation.
        const response = await (options.fetch ?? fetch)('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: step.maxTokens, pad: 'x'.repeat(step.input) }),
        });
        await response.text();
      } catch {
        // The pipeline turns a failed model call into an event; the run carries on.
      }
      return { assertions: [], judge: null, passed: true };
    };
    return { runHarness, calls: () => calls, baseFetch };
  }

  interface Written {
    spend: { budgetUsd: number; spentUsd: number; refusedRequests: number; stoppedBefore: { id: number; run: number } | null };
    cases: Array<{ id: number; runs: number; requestedRuns: number; incomplete?: boolean; cutRun?: unknown; results: Array<{ spendUsd: number }> }>;
    incomplete: number[];
    passAtAll: number[];
  }

  function written(file: string | null): Written {
    return JSON.parse(readFileSync(file ?? '', 'utf8')) as Written;
  }

  // 100K input + 50K output tokens of Sonnet = $0.70 per case-run; it reserves about $0.75.
  const even = () => ({ input: 100_000, output: 50_000, maxTokens: 50_000 });

  it('stops between cases when the next run could pass the budget, and writes neither full.json nor latest.json', async () => {
    const dir = tempResults();
    const stub = meteredHarness(even);
    const result = await execute(['--budget-usd', '2'], { resultsDir: dir, runHarness: stub.runHarness, baseFetch: stub.baseFetch });
    // After two runs ($1.40) a third could reach $2.10.
    expect(stub.calls()).toBe(2);
    expect(existsSync(join(dir, 'full.json'))).toBe(false);
    expect(existsSync(join(dir, 'latest.json'))).toBe(false);
    const out = written(result.resultsFile);
    expect(out.spend.budgetUsd).toBe(2);
    expect(out.spend.spentUsd).toBeCloseTo(1.4, 6);
    expect(out.spend.stoppedBefore).toMatchObject({ id: allIds[2], run: 1 });
    expect(out.cases.map((item) => item.id)).toEqual(allIds.slice(0, 2));
    expect(out.cases[0]?.results[0]?.spendUsd).toBeCloseTo(0.7, 6);
  });

  it('a case stopped part-way through its runs is marked incomplete and is not counted as passing', async () => {
    const dir = tempResults();
    const stub = meteredHarness(even);
    const result = await execute(['--case', '1', '--runs', '3', '--budget-usd', '2'], {
      resultsDir: dir,
      runHarness: stub.runHarness,
      baseFetch: stub.baseFetch,
    });
    expect(stub.calls()).toBe(2);
    const out = written(result.resultsFile);
    expect(out.cases[0]).toMatchObject({ id: 1, runs: 2, requestedRuns: 3, incomplete: true });
    expect(out.incomplete).toEqual([1]);
    expect(out.passAtAll).toEqual([]);
    expect(result.stdout).toBe('passAtAll 0 flaky 0 failing 0');
  });

  it('refuses a first request that could pass the budget on its own; that run is kept for diagnosis but never scored', async () => {
    const dir = tempResults();
    // max_tokens 300_000 of Sonnet reserves $3 against a $2 budget.
    const stub = meteredHarness(() => ({ input: 10, output: 10, maxTokens: 300_000 }));
    const result = await execute(['--case', '1', '--budget-usd', '2'], {
      resultsDir: dir,
      runHarness: stub.runHarness,
      baseFetch: stub.baseFetch,
    });
    const out = written(result.resultsFile);
    expect(out.spend.spentUsd).toBe(0);
    expect(out.spend.refusedRequests).toBe(1);
    expect(out.cases[0]).toMatchObject({ id: 1, runs: 0, requestedRuns: 1, incomplete: true });
    expect(out.cases[0]?.cutRun).toBeDefined();
    expect(out.passAtAll).toEqual([]);
  });

  it('a response that costs more than its reservation cuts the run and is never scored', async () => {
    const dir = tempResults();
    const stub = meteredHarness(() => ({ input: 100_000, output: 50_000, maxTokens: 50_000 }));
    // Report more input than the padded body can hold: the meter must treat that as unknown spend.
    const overrun = (async () =>
      new Response(JSON.stringify({ model: 'claude-sonnet-5-5', usage: { input_tokens: 900_000, output_tokens: 50_000 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const result = await execute(['--case', '1', '--budget-usd', '10'], {
      resultsDir: dir,
      runHarness: stub.runHarness,
      baseFetch: overrun,
    });
    const out = written(result.resultsFile);
    expect(out.cases[0]).toMatchObject({ id: 1, runs: 0, incomplete: true });
    expect(out.cases[0]?.cutRun).toBeDefined();
    expect(out.passAtAll).toEqual([]);
  });

  it('a cheap case cannot license a dear one: the dear request is refused before it is sent', async () => {
    const dir = tempResults();
    const ids = allIds.slice(0, 2);
    const first = ids[0] ?? 1;
    // First case: $0.10 (it reserves about $0.13). Second asks for 100_000 output tokens: a $1 reservation against $0.90 left.
    const stub = meteredHarness((id) =>
      id === first ? { input: 50_000, output: 0, maxTokens: 10 } : { input: 10, output: 10, maxTokens: 100_000 },
    );
    const result = await execute(['--cases', ids.join(','), '--budget-usd', '1'], {
      resultsDir: dir,
      runHarness: stub.runHarness,
      baseFetch: stub.baseFetch,
    });
    const out = written(result.resultsFile);
    expect(out.spend.spentUsd).toBeCloseTo(0.1, 6);
    expect(out.spend.spentUsd).toBeLessThanOrEqual(1);
    expect(out.passAtAll).toEqual([first]);
    expect(out.incomplete).toEqual([ids[1]]);
  });

  it('a run inside the budget completes every case', async () => {
    const dir = tempResults();
    const stub = meteredHarness(even);
    const result = await execute(['--cases', '1,2', '--budget-usd', '5'], {
      resultsDir: dir,
      runHarness: stub.runHarness,
      baseFetch: stub.baseFetch,
    });
    expect(stub.calls()).toBe(2);
    const out = written(result.resultsFile);
    expect(out.spend.stoppedBefore).toBeNull();
    expect(out.incomplete).toEqual([]);
    expect(out.passAtAll).toEqual([1, 2]);
  });
});
