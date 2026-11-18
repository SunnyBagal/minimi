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
      error: null,
    });
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
