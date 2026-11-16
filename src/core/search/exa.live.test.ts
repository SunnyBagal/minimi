// Live-network tests. Run with EXA_LIVE=1 (vitest.config loads .env then).
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config';
import { systemClock } from '../systemClock';
import { createSearch } from './index';

describe.runIf(process.env.EXA_LIVE)('Exa live', () => {
  const apiKey = process.env.EXA_API_KEY ?? '';
  const provider = createSearch(apiKey, systemClock, defaultConfig);

  it('search returns results with text', async () => {
    const results = await provider.search({
      query: 'managed Postgres hosting pricing',
      numResults: 2,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const result of results) {
      expect(result.url).toMatch(/^https?:\/\//);
      expect(result.text.length).toBeGreaterThan(0);
    }
  });

  it('fetchPage returns page text', async () => {
    const page = await provider.fetchPage({
      url: 'https://www.postgresql.org/about/',
      deadlineMs: defaultConfig.deadlinesMs.recheckFetch,
    });
    expect(page.status).toBe('ok');
    expect(page.text).toContain('PostgreSQL');
    // `live` is provider-reported and may be true or false; the assertion is
    // only that it is a boolean (the value is recorded in the handoff).
    expect(typeof page.live).toBe('boolean');
  });
});
