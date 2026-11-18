import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CASES } from './cases/index';
import { execute, parseEvalArgs, QUICK_IDS, resultsFileName, writesLatest } from './run';

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
});

describe('writesLatest', () => {
  it('is true only for a live run whose ids are exactly every case', () => {
    expect(writesLatest({ selftest: false, quick: false, ids: allIds })).toBe(true);
    expect(writesLatest({ selftest: false, quick: false, ids: [17] })).toBe(false);
    expect(writesLatest({ selftest: false, quick: true, ids: allIds })).toBe(false);
    expect(writesLatest({ selftest: true, quick: false, ids: allIds })).toBe(false);
    const missingOne = [2, ...allIds.slice(1)];
    expect(missingOne).toHaveLength(allIds.length);
    expect(writesLatest({ selftest: false, quick: false, ids: missingOne })).toBe(false);
    expect(writesLatest({ selftest: false, quick: false, ids: [...allIds, 1] })).toBe(false);
  });
});

describe('resultsFileName', () => {
  it('sends a quick live run to quick.json and every other run to a stamp', () => {
    expect(resultsFileName({ selftest: false, quick: true }, '2026-11-18T00-00-00.000Z')).toBe('quick.json');
    expect(resultsFileName({ selftest: true, quick: true }, 'stamp')).toBe('stamp.json');
    expect(resultsFileName({ selftest: false, quick: false }, 'stamp')).toBe('stamp.json');
  });
});

describe('partial run', () => {
  it('never overwrites latest.json', async () => {
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
