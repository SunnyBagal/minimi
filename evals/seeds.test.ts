import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { containsQuote } from '../src/core/search/index';
import { createStore } from '../src/core/store/index';
import { FakeClock } from '../src/core/testing/fakes';
import { loadSeeds, type SeedId } from './seeds';

const IDS: SeedId[] = ['S-PG', 'S-NOV3', 'S-CRM', 'S-PG-OLD', 'S-LATE', 'S-LA'];

describe('seeds', () => {
  it('every seed claim quote passes containsQuote against its source', () => {
    const store = createStore('seed-test', new FakeClock('2026-11-13T13:00:00.000Z'), defaultConfig);
    loadSeeds(store, IDS);
    const hits = store.findTurns({
      dates: ['2026-11-03', '2026-11-05', '2026-11-09', '2026-11-10'],
      excludeTurnIds: [],
      limit: 20,
    });
    const claims = store.claimsForTurns(
      hits.flatMap((hit) => (hit.assistantTurn === null ? [] : [hit.assistantTurn.id])),
      'as_stated',
    );
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      const source = store.getSources([claim.sourceId])[0];
      expect(source, claim.entity).toBeDefined();
      expect(containsQuote(source?.text ?? '', claim.quote), `${claim.entity} ${claim.quote}`).toBe(true);
    }
    const assistants = hits.flatMap((hit) => (hit.assistantTurn === null ? [] : [hit.assistantTurn]));
    expect(assistants.every((turn) => turn.origin === 'seed' && turn.intent === 'fresh' && turn.extraction === 'done')).toBe(
      true,
    );
    expect(claims.some((claim) => claim.entity === 'Salesyard')).toBe(true);
    expect(claims.some((claim) => claim.entity === 'Northwind PG')).toBe(true);
    const blog = createStore('seed-blog', new FakeClock('2026-11-13T13:00:00.000Z'), defaultConfig);
    loadSeeds(blog, ['S-PG'], { northwindFromBlog: true });
    const blogHits = blog.findTurns({ dates: ['2026-11-10'], excludeTurnIds: [], limit: 5 });
    const blogClaims = blog.claimsForTurns(
      blogHits.flatMap((hit) => (hit.assistantTurn === null ? [] : [hit.assistantTurn.id])),
      'as_stated',
    );
    const northwind = blogClaims.find((claim) => claim.entity === 'Northwind PG');
    const blogSource = blog.getSources([northwind?.sourceId ?? ''])[0];
    expect(blogSource?.url).toContain('thirdparty.test');
    expect(containsQuote(blogSource?.text ?? '', northwind?.quote ?? '')).toBe(true);
  });
});
