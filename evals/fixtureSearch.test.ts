import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/core/testing/fakes';
import { FixtureSearch } from './fixtureSearch';
import { URLS } from './pages';

const clock = new FakeClock('2026-11-13T13:00:00.000Z');

describe('fixtureSearch', () => {
  it('serves v1 or v2 for the same url and marks the page live', async () => {
    const v1 = new FixtureSearch(clock, {
      pages: { [URLS.northwindPricing]: { file: 'northwind-pricing-v1.txt' } },
      searches: [],
    });
    const v2 = new FixtureSearch(clock, {
      pages: { [URLS.northwindPricing]: { file: 'northwind-pricing-v2.txt' } },
      searches: [],
    });
    const first = await v1.fetchPage({ url: URLS.northwindPricing, deadlineMs: 1000 });
    const second = await v2.fetchPage({ url: URLS.northwindPricing, deadlineMs: 1000 });
    expect(first.status).toBe('ok');
    expect(first.live).toBe(true);
    expect(first.text).toContain('19 USD per month');
    expect(second.text).toContain('24 USD per month');
    expect(second.text).not.toContain('19 USD per month');
  });

  it('returns scripted timeout and not_found without throwing', async () => {
    const search = new FixtureSearch(clock, {
      pages: {
        [URLS.northwindPricing]: { failure: 'timeout' },
        [URLS.salesyardPricing]: { failure: 'not_found' },
      },
      searches: [],
    });
    const timeout = await search.fetchPage({ url: URLS.northwindPricing, deadlineMs: 8000 });
    const missing = await search.fetchPage({ url: URLS.salesyardPricing, deadlineMs: 8000 });
    expect(timeout.status).toBe('timeout');
    expect(timeout.live).toBe(false);
    expect(missing.status).toBe('not_found');
    expect(missing.httpStatus).toBe(404);
  });

  it('matches search hits by substring and records every call', async () => {
    const search = new FixtureSearch(clock, {
      pages: {},
      searches: [
        {
          match: 'closewise news',
          results: [
            {
              url: URLS.closewiseChangelog,
              title: 'Closewise changelog',
              publishedAt: '2026-11-11T04:00:00.000Z',
              text: '11 Nov 2026: Closewise shipped shared inboxes.',
            },
          ],
        },
        { match: 'salesyard', results: [] },
      ],
    });
    const news = await search.search({ query: 'Closewise news', numResults: 5 });
    const none = await search.search({ query: 'Salesyard price', numResults: 5 });
    expect(news).toHaveLength(1);
    expect(news[0]?.publishedAt).toBe('2026-11-11T04:00:00.000Z');
    expect(none).toEqual([]);
    expect(search.log).toEqual([
      { kind: 'search', query: 'Closewise news', numResults: 5, publishedOnOrAfter: null },
      { kind: 'search', query: 'Salesyard price', numResults: 5, publishedOnOrAfter: null },
    ]);
  });
});
