import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET } from './route';
import { EVAL_SETS, evalSetOf, evalsRequest, evalsResponse, summarizeEvals } from './summary';

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
    const response = await GET(new Request('http://localhost/api/evals'));
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

describe('GET /api/evals?set=', () => {
  const withSha = (sha: string, ids: number[]) => ({
    ...RESULTS,
    sha,
    cases: ids.map((id) => ({ id, runs: 3, requestedRuns: 3, passedRuns: 3, results: [] })),
    passAtAll: ids,
    flaky: [],
    failing: [],
    strict: { passAtAll: ids, flaky: [], failing: [] },
  });
  let setsDir = '';
  beforeAll(async () => {
    setsDir = await mkdtemp(path.join(tmpdir(), 'evals-sets-'));
    await writeFile(path.join(setsDir, 'latest.json'), JSON.stringify(withSha('aaaaaaa111', [1, 2])));
    await writeFile(path.join(setsDir, 'heldout.json'), JSON.stringify(withSha('bbbbbbb222', [101, 102, 103])));
    await writeFile(path.join(setsDir, 'heldout-first.json'), JSON.stringify(withSha('ccccccc333', [101])));
  });
  afterAll(async () => {
    await rm(setsDir, { recursive: true, force: true });
  });
  const get = async (query: string) =>
    evalsRequest(`http://localhost/api/evals${query}`, (set) => path.join(setsDir, EVAL_SETS[set]));

  it('main (and no set at all) serves latest.json', async () => {
    for (const query of ['', '?set=main', '?set=']) {
      const response = await get(query);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ sha: 'aaaaaaa', cases: 2, passAtAll: [1, 2] });
    }
  });

  it('heldout serves heldout.json and heldout-first serves heldout-first.json, same projection', async () => {
    const latest = await get('?set=heldout');
    expect(latest.status).toBe(200);
    const body = (await latest.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ sha: 'bbbbbbb', cases: 3, passAtAll: [101, 102, 103] });
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
    const first = await get('?set=heldout-first');
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ sha: 'ccccccc', cases: 1, passAtAll: [101] });
  });

  it('an unknown set is 400 and names the known sets', async () => {
    for (const query of ['?set=foo', '?set=__proto__', '?set=MAIN']) {
      const response = await get(query);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain('main, heldout, heldout-first');
    }
  });

  it('a missing set file is 404 naming that file', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'evals-empty-'));
    try {
      for (const [set, file] of [
        ['main', 'latest.json'],
        ['heldout', 'heldout.json'],
        ['heldout-first', 'heldout-first.json'],
      ] as const) {
        const response = await evalsRequest(`http://localhost/api/evals?set=${set}`, (s) =>
          path.join(empty, EVAL_SETS[s]),
        );
        expect(response.status).toBe(404);
        expect(((await response.json()) as { error: string }).error).toContain(file);
      }
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('a held-out file that is not results is 500', async () => {
    const bad = await mkdtemp(path.join(tmpdir(), 'evals-bad-'));
    try {
      await writeFile(path.join(bad, 'heldout.json'), '{not json');
      expect(
        (await evalsRequest('http://localhost/api/evals?set=heldout', (set) => path.join(bad, EVAL_SETS[set]))).status,
      ).toBe(500);
    } finally {
      await rm(bad, { recursive: true, force: true });
    }
  });

  it('evalSetOf maps the parameter', () => {
    expect([evalSetOf(null), evalSetOf(''), evalSetOf('heldout'), evalSetOf('heldout-first'), evalSetOf('x')]).toEqual([
      'main',
      'main',
      'heldout',
      'heldout-first',
      null,
    ]);
  });

  it('the route serves the project held-out files', async () => {
    for (const set of ['heldout', 'heldout-first']) {
      const response = await GET(new Request(`http://localhost/api/evals?set=${set}`));
      expect([200, 404]).toContain(response.status);
    }
    expect((await GET(new Request('http://localhost/api/evals?set=nope'))).status).toBe(400);
  });
});
