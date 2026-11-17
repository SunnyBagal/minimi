import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { execute } from './run';

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

describe('selftest', () => {
  it('exits 0 and makes no network call', async () => {
    const dir = tempResults();
    const result = await execute(['--selftest'], { resultsDir: dir });
    expect(result.networkCalls).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^passAtAll \d+ flaky \d+ failing \d+$/);
    expect(result.resultsFile?.startsWith(dir)).toBe(true);
    const written = JSON.parse(readFileSync(result.resultsFile ?? '', 'utf8')) as {
      mode: string;
      cases: Array<{ id: number; passedRuns: number; runs: number }>;
      passAtAll: number[];
      flaky: number[];
      failing: number[];
      strict: { passAtAll: number[]; flaky: number[]; failing: number[] };
    };
    expect(written.mode).toBe('selftest');
    const chat = written.cases.find((item) => item.id === 17);
    expect(chat?.passedRuns).toBe(chat?.runs);
    expect(written.passAtAll).toContain(17);
    expect(written.passAtAll).not.toContain(1);
    expect(written.flaky).not.toContain(17);
    expect(written.strict.passAtAll).toContain(17);
    expect(written.strict.passAtAll).not.toContain(1);
    expect(existsSync(join(dir, 'latest.json'))).toBe(false);
  });

  it('leaves evals/results/latest.json unchanged', async () => {
    const before = repoSnapshot();
    const dir = tempResults();
    const sentinel = '{"mode":"live","keep":true}\n';
    writeFileSync(join(dir, 'latest.json'), sentinel);

    const result = await execute(['--selftest'], { resultsDir: dir });

    expect(result.exitCode).toBe(0);
    expect(result.resultsFile?.startsWith(dir)).toBe(true);
    expect(readFileSync(join(dir, 'latest.json'), 'utf8')).toBe(sentinel);
    expect(repoSnapshot()).toEqual(before);
  });
});
