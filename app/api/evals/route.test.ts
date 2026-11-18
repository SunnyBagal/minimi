import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET } from './route';
import { evalsResponse, summarizeEvals } from './summary';

const RESULTS = {
  mode: 'live',
  sha: '6996020e9b76603e474eb0b0c377aaa9d7d9226a',
  runs: 3,
  spend: { budgetUsd: 4.5, spentUsd: 0.357843, byModel: { haiku: 0.1 } },
  cases: [
    {
      id: 1,
      runs: 3,
      requestedRuns: 3,
      passedRuns: 3,
      results: [
        {
          run: 1,
          passed: true,
          assertions: [{ name: 'SECRET_ASSERTION' }],
          judge: 'SECRET_JUDGE',
          trace: ['SECRET_TRACE'],
          spendUsd: 0.01,
        },
      ],
    },
    {
      id: 2,
      runs: 3,
      requestedRuns: 3,
      passedRuns: 1,
      results: [
        {
          run: 1,
          passed: false,
          assertions: [],
          judge: null,
          trace: ['SECRET_ANSWER'],
          spendUsd: 0.01,
        },
      ],
    },
    { id: 3, runs: 3, requestedRuns: 3, passedRuns: 0, results: [] },
  ],
  incomplete: [],
  passAtAll: [1],
  flaky: [2],
  failing: [3],
  strict: { passAtAll: [], flaky: [1], failing: [2, 3] },
};

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'evals-route-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fileWith(name: string, content: string): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, content);
  return file;
}

describe('GET /api/evals summary', () => {
  it('returns every summary field', async () => {
    const response = await evalsResponse(await fileWith('ok.json', JSON.stringify(RESULTS)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sha: '6996020',
      runs: 3,
      cases: 3,
      passAtAll: [1],
      flaky: [2],
      failing: [3],
      strict: { passAtAll: [], flaky: [1], failing: [2, 3] },
      incomplete: [],
      spentUsd: 0.357843,
    });
  });

  it('never sends traces, assertions, judge notes, answers or the per-model spend', async () => {
    const body = await (await evalsResponse(await fileWith('ok2.json', JSON.stringify(RESULTS)))).text();
    for (const secret of [
      'SECRET_ASSERTION',
      'SECRET_JUDGE',
      'SECRET_TRACE',
      'SECRET_ANSWER',
      'trace',
      'assertions',
      'results',
      'byModel',
      'budgetUsd',
    ]) {
      expect(body).not.toContain(secret);
    }
  });

  it('is 404 when the results file is missing', async () => {
    const response = await evalsResponse(path.join(dir, 'missing.json'));
    expect(response.status).toBe(404);
    expect((await response.json()) as { error: string }).toHaveProperty('error');
  });

  it('is 500 for a file that is not results', async () => {
    expect((await evalsResponse(await fileWith('bad.json', '{not json'))).status).toBe(500);
    expect((await evalsResponse(await fileWith('shape.json', '{"sha":"abc"}'))).status).toBe(500);
  });

  it('spentUsd is null when the file records no spend', () => {
    const { spend: _spend, ...rest } = RESULTS;
    expect(summarizeEvals(rest)?.spentUsd).toBeNull();
  });

  it('the route reads evals/results/latest.json from the project', async () => {
    const response = await GET();
    expect([200, 404]).toContain(response.status);
    if (response.status === 200) {
      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual([
        'cases',
        'failing',
        'flaky',
        'incomplete',
        'passAtAll',
        'runs',
        'sha',
        'spentUsd',
        'strict',
      ]);
    }
  });
});
