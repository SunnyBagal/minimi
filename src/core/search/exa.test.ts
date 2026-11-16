import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../contracts';
import { defaultConfig } from '../config';
import { FakeClock } from '../testing/fakes';
import { createExaSearch } from './exa';

const NOW = '2026-11-10T20:00:00.000Z';
const API_KEY = 'test-exa-key';
const ABOUT_URL = 'https://www.postgresql.org/about/';
const INVALID_URL = 'https://nonexistent-host.invalid/pricing';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as T;
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

type FetchHandler = (url: string, init: RequestInit) => Promise<Response>;

function stubFetch(handler: FetchHandler) {
  const calls: FetchCall[] = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call.url, call.init);
  }) as typeof fetch;
  return { calls, fetchFn };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const abortableHang = (init: RequestInit): Promise<Response> =>
  new Promise((_, reject) => {
    const signal = init.signal;
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });

function makeSearch(config: AgentConfig = defaultConfig, handler: FetchHandler = () => Promise.resolve(jsonResponse(fixture('probe-contents.json')))) {
  const clock = new FakeClock(NOW);
  const { calls, fetchFn } = stubFetch(handler);
  const provider = createExaSearch(API_KEY, clock, config, fetchFn);
  return { provider, calls, clock };
}

function configWith(overrides: { sourceTextChars?: number; searchDeadlineMs?: number }): AgentConfig {
  return {
    ...defaultConfig,
    limits: {
      ...defaultConfig.limits,
      ...(overrides.sourceTextChars !== undefined ? { sourceTextChars: overrides.sourceTextChars } : {}),
    },
    deadlinesMs: {
      ...defaultConfig.deadlinesMs,
      ...(overrides.searchDeadlineMs !== undefined ? { search: overrides.searchDeadlineMs } : {}),
    },
  };
}

describe('fetchPage request shape', () => {
  it('fetchPage sends maxAgeHours: 0', async () => {
    const { provider, calls } = makeSearch();
    await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });

    const call = calls[0];
    expect(call?.url).toBe('https://api.exa.ai/contents');
    expect(call?.init.method).toBe('POST');
    const headers = new Headers(call?.init.headers);
    expect(headers.get('x-api-key')).toBe(API_KEY);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(call?.init.body))).toEqual({
      urls: [ABOUT_URL],
      text: { maxCharacters: defaultConfig.limits.sourceTextChars },
      maxAgeHours: 0,
      livecrawlTimeout: 8000,
    });
  });

  it('clamps livecrawlTimeout to the provider bounds', async () => {
    const { provider, calls } = makeSearch();
    await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 0.5 });
    await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 120000 });
    const first = JSON.parse(String(calls[0]?.init.body)) as { livecrawlTimeout: number };
    const second = JSON.parse(String(calls[1]?.init.body)) as { livecrawlTimeout: number };
    expect(first.livecrawlTimeout).toBe(1);
    expect(second.livecrawlTimeout).toBe(90000);
  });
});

describe('search request shape', () => {
  it('search sends the documented request body', async () => {
    const { provider, calls } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(fixture('probe-search.json'))));
    await provider.search({ query: 'managed Postgres hosting pricing', numResults: 3 });

    const call = calls[0];
    expect(call?.url).toBe('https://api.exa.ai/search');
    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      query: 'managed Postgres hosting pricing',
      type: 'auto',
      numResults: 3,
      contents: { text: { maxCharacters: defaultConfig.limits.sourceTextChars } },
    });
    expect('maxAgeHours' in body).toBe(false);
    expect('objective' in body).toBe(false);
    expect('category' in body).toBe(false);
  });

  it('adds startPublishedDate only when publishedOnOrAfter is given', async () => {
    const { provider, calls } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(fixture('search-dated.json'))));
    await provider.search({
      query: 'managed Postgres hosting pricing',
      numResults: 3,
      publishedOnOrAfter: '2026-10-01',
    });
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body.startPublishedDate).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('fetchPage outcomes', () => {
  it('ok live: crawled status', async () => {
    const { provider } = makeSearch();
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.status).toBe('ok');
    expect(page.live).toBe(true);
    expect(page.text).toContain('PostgreSQL');
  });

  it('ok live inferred: no per-URL status', async () => {
    const body = fixture<Record<string, unknown>>('probe-contents.json');
    delete body.statuses;
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(body)));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.status).toBe('ok');
    expect(page.live).toBe(true);
  });

  it('ok live inferred: statuses field present but empty', async () => {
    const body = fixture<Record<string, unknown>>('probe-contents.json');
    body.statuses = [];
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(body)));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.status).toBe('ok');
    expect(page.live).toBe(true);
  });

  it('ok not live: statuses present but none for this URL', async () => {
    const body = fixture<Record<string, unknown>>('probe-contents.json');
    // A status entry exists, but it names a different URL: live is not inferred.
    body.statuses = [{ id: 'https://other.example.test/', status: 'success', source: 'crawled' }];
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(body)));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.status).toBe('ok');
    expect(page.live).toBe(false);
  });

  it('ok not live: served from cache', async () => {
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(fixture('contents-cached.json'))));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.status).toBe('ok');
    expect(page.live).toBe(false);
  });

  it('ok not live: crawl failed but text returned', async () => {
    const body = fixture('probe-contents.json') as { statuses: unknown[] };
    // Keep the result entry but mark its status as a failed crawl.
    body.statuses = [
      { id: ABOUT_URL, status: 'error', error: { tag: 'CRAWL_UNKNOWN_ERROR', httpStatusCode: 500 } },
    ];
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(body)));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.status).toBe('ok');
    expect(page.live).toBe(false);
    expect(page.httpStatus).toBe(500);
  });

  it('not_found', async () => {
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(fixture('contents-not-found.json'))));
    const page = await provider.fetchPage({
      url: 'https://www.postgresql.org/this-page-does-not-exist-minimi',
      deadlineMs: 8000,
    });
    expect(page.status).toBe('not_found');
    expect(page.httpStatus).toBe(404);
    expect(page.live).toBe(false);
  });

  it('not_found for a 410 crawl error', async () => {
    const body = fixture('contents-not-found.json') as { statuses: { error: { tag: string; httpStatusCode: number } }[] };
    body.statuses[0]!.error.tag = 'CRAWL_HTTP_410';
    body.statuses[0]!.error.httpStatusCode = 410;
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(body)));
    const page = await provider.fetchPage({ url: 'https://www.postgresql.org/this-page-does-not-exist-minimi', deadlineMs: 8000 });
    expect(page.status).toBe('not_found');
    expect(page.httpStatus).toBe(410);
  });

  it('blocked for CRAWL_HTTP_403', async () => {
    // Fixture hand-built from docs/admin/error-codes (prefix constructed-).
    const { provider } = makeSearch(defaultConfig, () =>
      Promise.resolve(jsonResponse(fixture('constructed-contents-http-403.json'))),
    );
    const page = await provider.fetchPage({ url: 'https://blocked.example.test/pricing', deadlineMs: 8000 });
    expect(page.status).toBe('blocked');
    expect(page.httpStatus).toBe(403);
  });

  it('blocked for SOURCE_NOT_AVAILABLE', async () => {
    // Fixture hand-built from docs/admin/error-codes (prefix constructed-).
    const { provider } = makeSearch(defaultConfig, () =>
      Promise.resolve(jsonResponse(fixture('constructed-contents-source-not-available.json'))),
    );
    const page = await provider.fetchPage({ url: 'https://blocked.example.test/pricing', deadlineMs: 8000 });
    expect(page.status).toBe('blocked');
    expect(page.httpStatus).toBeNull();
  });

  it('blocked for a 401 crawl error', async () => {
    const body = fixture('constructed-contents-http-403.json') as { statuses: { error: { tag: string; httpStatusCode: number } }[] };
    body.statuses[0]!.error.tag = 'CRAWL_HTTP_401';
    body.statuses[0]!.error.httpStatusCode = 401;
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(body)));
    const page = await provider.fetchPage({ url: 'https://blocked.example.test/pricing', deadlineMs: 8000 });
    expect(page.status).toBe('blocked');
    expect(page.httpStatus).toBe(401);
  });

  it('timeout: deadline passed', async () => {
    const { provider } = makeSearch(defaultConfig, (_url, init) => abortableHang(init));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 20 });
    expect(page.status).toBe('timeout');
    expect(page.live).toBe(false);
  });

  it('timeout: caller aborted', async () => {
    const { provider } = makeSearch(defaultConfig, (_url, init) => abortableHang(init));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000, signal: AbortSignal.abort() });
    expect(page.status).toBe('timeout');
  });

  it('timeout: provider reports CRAWL_LIVECRAWL_TIMEOUT', async () => {
    const { provider } = makeSearch(defaultConfig, () =>
      Promise.resolve(jsonResponse(fixture('contents-livecrawl-timeout.json'))),
    );
    const page = await provider.fetchPage({
      url: 'https://www.postgresql.org/docs/current/index.html',
      deadlineMs: 1,
    });
    expect(page.status).toBe('timeout');
    expect(page.httpStatus).toBe(504);
  });

  it('timeout: HTTP 504', async () => {
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse({}, 504)));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.status).toBe('timeout');
    expect(page.httpStatus).toBeNull();
  });

  it('error: provider reports CRAWL_UNKNOWN_ERROR', async () => {
    const { provider } = makeSearch();
    const page = await provider.fetchPage({ url: INVALID_URL, deadlineMs: 8000 });
    expect(page.status).toBe('error');
    expect(page.httpStatus).toBe(500);
  });

  it('error: HTTP 500 request-level', async () => {
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse({ error: 'boom' }, 500)));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.status).toBe('error');
    expect(page.httpStatus).toBeNull();
  });

  it('error: HTTP 401 request-level', async () => {
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse({ error: 'bad key' }, 401)));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.status).toBe('error');
  });

  it('error: fetch rejects', async () => {
    const { provider } = makeSearch(defaultConfig, () => Promise.reject(new TypeError('fetch failed')));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.status).toBe('error');
  });

  it('error: success without result', async () => {
    const body = { requestId: 'x', results: [], statuses: [{ id: ABOUT_URL, status: 'success', source: 'crawled' }] };
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(body)));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.status).toBe('error');
  });

  it('fetchPage returns error on a non-JSON response', async () => {
    const { provider } = makeSearch(defaultConfig, () =>
      Promise.resolve(new Response('<html>oops</html>', { status: 200 })),
    );
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.status).toBe('error');
  });
});

describe('live flag', () => {
  it('live is never true unless crawled or unreported', async () => {
    const cases: { fixtureName: string; url: string; wantLive: boolean }[] = [
      { fixtureName: 'probe-contents.json', url: ABOUT_URL, wantLive: true },
      { fixtureName: 'contents-cached.json', url: ABOUT_URL, wantLive: false },
      { fixtureName: 'contents-not-found.json', url: 'https://www.postgresql.org/this-page-does-not-exist-minimi', wantLive: false },
      { fixtureName: 'contents-livecrawl-timeout.json', url: 'https://www.postgresql.org/docs/current/index.html', wantLive: false },
      { fixtureName: 'constructed-contents-http-403.json', url: 'https://blocked.example.test/pricing', wantLive: false },
      { fixtureName: 'constructed-contents-source-not-available.json', url: 'https://blocked.example.test/pricing', wantLive: false },
    ];
    for (const c of cases) {
      const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(fixture(c.fixtureName))));
      const page = await provider.fetchPage({ url: c.url, deadlineMs: 8000 });
      expect(page.live, c.fixtureName).toBe(c.wantLive);
    }

    // A status entry that names a different URL must not make this page live.
    const mismatched = fixture<Record<string, unknown>>('probe-contents.json');
    mismatched.statuses = [{ id: 'https://other.example.test/', status: 'success', source: 'crawled' }];
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(mismatched)));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.live).toBe(false);
  });
});

describe('fetchPage field mapping', () => {
  it('fetchedAtUtc comes from the Clock', async () => {
    const { provider } = makeSearch();
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.fetchedAtUtc).toBe(NOW);
  });

  it('finalUrl from the provider result', async () => {
    const body = fixture<{ results: { url: string }[] }>('probe-contents.json');
    body.results[0]!.url = 'https://www.postgresql.org/about-us/';
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(body)));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.finalUrl).toBe('https://www.postgresql.org/about-us/');
  });

  it('text capped at sourceTextChars', async () => {
    const { provider } = makeSearch(configWith({ sourceTextChars: 50 }));
    const page = await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 8000 });
    expect(page.text.length).toBe(50);
  });
});

describe('search mapping', () => {
  it('search maps results', async () => {
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(fixture('probe-search.json'))));
    const results = await provider.search({ query: 'managed Postgres hosting pricing', numResults: 3 });
    expect(results).toHaveLength(3);
    expect(results[0]?.url).toBe('https://c17.io/compare/managed-postgres');
    expect(results[0]?.publishedAt).toBeNull();
    expect(results[1]?.publishedAt).toBe('2025-05-06T15:00:00.000Z');
    expect(results[0]?.text.length).toBeGreaterThan(0);
  });

  it('search drops results without a url', async () => {
    const body = fixture<{ results: Record<string, unknown>[] }>('probe-search.json');
    body.results.push({ title: 'No url here', text: 'some text' });
    const { provider } = makeSearch(defaultConfig, () => Promise.resolve(jsonResponse(body)));
    const results = await provider.search({ query: 'x', numResults: 4 });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.url !== '')).toBe(true);
  });

  it('search maps dated results', async () => {
    const { provider } = makeSearch(configWith({ sourceTextChars: 100 }), () =>
      Promise.resolve(jsonResponse(fixture('search-dated.json'))),
    );
    const results = await provider.search({ query: 'q', numResults: 3 });
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.publishedAt).not.toBeNull();
      expect(r.text.length).toBe(100);
    }
  });
});

describe('search failure paths resolve to []', () => {
  const cases: { name: string; handler: FetchHandler; config?: AgentConfig }[] = [
    { name: 'on timeout', config: configWith({ searchDeadlineMs: 20 }), handler: (_url, init) => abortableHang(init) },
    { name: 'on HTTP error', handler: () => Promise.resolve(jsonResponse({ error: 'boom' }, 500)) },
    { name: 'on non-JSON response', handler: () => Promise.resolve(new Response('nope', { status: 200 })) },
    { name: 'on fetch rejection', handler: () => Promise.reject(new TypeError('fetch failed')) },
    { name: 'on missing results array', handler: () => Promise.resolve(jsonResponse({ unexpected: true })) },
  ];
  for (const c of cases) {
    it(`search returns [] ${c.name}`, async () => {
      const { provider } = makeSearch(c.config ?? defaultConfig, c.handler);
      await expect(provider.search({ query: 'x', numResults: 2 })).resolves.toEqual([]);
    });
  }

  it('search returns [] on caller abort', async () => {
    const { provider } = makeSearch(defaultConfig, (_url, init) => abortableHang(init));
    await expect(
      provider.search({ query: 'x', numResults: 2, signal: AbortSignal.abort() }),
    ).resolves.toEqual([]);
  });
});

describe('no logging', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never logs', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const failing: FetchHandler[] = [
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(jsonResponse({ error: 'boom' }, 500)),
      () => Promise.resolve(new Response('not json', { status: 200 })),
      (_url, init) => abortableHang(init),
    ];
    for (const handler of failing) {
      const { provider } = makeSearch(configWith({ searchDeadlineMs: 20 }), handler);
      await provider.fetchPage({ url: ABOUT_URL, deadlineMs: 20 }).catch(() => {});
      await provider.search({ query: 'x', numResults: 1 }).catch(() => {});
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});


