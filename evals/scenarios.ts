/**
 * Page-version scenarios. v1 is what a seed stored. v2 is what the eval fetches.
 * Search hits are matched by substring, first match wins.
 */
import type { SearchResult } from '../src/core/contracts';
import type { FixtureScenario } from './fixtureSearch';
import { readFixture, URLS } from './pages';

function page(file: string): { file: string } {
  return { file };
}

function hit(url: string, publishedAt: string | null, file: string, title: string): SearchResult {
  return { url, title, publishedAt, text: readFixture(file) };
}

const unchangedCrm: FixtureScenario['pages'] = {
  [URLS.pipeloomPricing]: page('pipeloom-pricing-v2.txt'),
  [URLS.dealbasePricing]: page('dealbase-pricing-v1.txt'),
  [URLS.closewisePricing]: page('closewise-pricing-v2.txt'),
  [URLS.leadharborPricing]: page('leadharbor-pricing-v2.txt'),
  [URLS.salesyardPricing]: page('salesyard-pricing-v2.txt'),
};

/** Case 1: Dealbase changed, Salesyard 404, changelog posts on the two dates. */
export function scenarioCrmChanged(): FixtureScenario {
  return {
    pages: {
      ...unchangedCrm,
      [URLS.dealbasePricing]: page('dealbase-pricing-v2.txt'),
      [URLS.salesyardPricing]: { failure: 'not_found' },
      [URLS.closewiseChangelog]: page('closewise-changelog-v2.txt'),
      [URLS.leadharborChangelog]: page('leadharbor-changelog-v2.txt'),
    },
    searches: [
      {
        match: 'closewise news',
        results: [hit(URLS.closewiseChangelog, '2026-11-11T04:00:00.000Z', 'closewise-changelog-v2.txt', 'Closewise changelog')],
      },
      {
        match: 'leadharbor news',
        results: [hit(URLS.leadharborChangelog, '2026-11-02T02:30:00.000Z', 'leadharbor-changelog-v2.txt', 'Leadharbor changelog')],
      },
      { match: 'salesyard', results: [] },
      { match: 'dealbase', results: [hit(URLS.dealbasePricing, null, 'dealbase-pricing-v2.txt', 'Dealbase pricing')] },
      { match: 'pipeloom', results: [hit(URLS.pipeloomPricing, null, 'pipeloom-pricing-v2.txt', 'Pipeloom pricing')] },
      { match: 'closewise', results: [hit(URLS.closewisePricing, null, 'closewise-pricing-v2.txt', 'Closewise pricing')] },
      { match: 'leadharbor', results: [hit(URLS.leadharborPricing, null, 'leadharbor-pricing-v2.txt', 'Leadharbor pricing')] },
    ],
  };
}

/** Postgres pages with Northwind at 24 and Basalt still monthly. */
export function scenarioPgChanged(): FixtureScenario {
  return {
    pages: {
      [URLS.northwindPricing]: page('northwind-pricing-v2.txt'),
      [URLS.basaltPricing]: page('basalt-pricing-v2.txt'),
      [URLS.pipeloomPricing]: page('pipeloom-pricing-v2.txt'),
    },
    searches: [
      { match: 'northwind', results: [hit(URLS.northwindPricing, null, 'northwind-pricing-v2.txt', 'Northwind PG pricing')] },
      { match: 'basalt', results: [hit(URLS.basaltPricing, null, 'basalt-pricing-v2.txt', 'Basalt DB pricing')] },
      { match: 'pipeloom', results: [hit(URLS.pipeloomPricing, null, 'pipeloom-pricing-v2.txt', 'Pipeloom pricing')] },
    ],
  };
}

/** Case 2: Pipeloom Team page still has the seeded sentence. */
export function scenarioPipeloomSame(): FixtureScenario {
  return {
    pages: { [URLS.pipeloomPricing]: page('pipeloom-pricing-v2.txt') },
    searches: [
      { match: 'pipeloom', results: [hit(URLS.pipeloomPricing, null, 'pipeloom-pricing-v2.txt', 'Pipeloom pricing')] },
    ],
  };
}

/** Case 10: a fresh search returns the v1 Basalt pricing page. */
export function scenarioBasaltV1Search(): FixtureScenario {
  return {
    pages: { [URLS.basaltPricing]: page('basalt-pricing-v1.txt') },
    searches: [
      { match: 'basalt', results: [hit(URLS.basaltPricing, null, 'basalt-pricing-v1.txt', 'Basalt DB pricing')] },
    ],
  };
}

/** Case 12: a fresh shortlist. Each tool's v1 page is searchable. */
export function scenarioCrmFresh(): FixtureScenario {
  return {
    pages: {
      [URLS.pipeloomPricing]: page('pipeloom-pricing-v1.txt'),
      [URLS.dealbasePricing]: page('dealbase-pricing-v1.txt'),
      [URLS.closewisePricing]: page('closewise-pricing-v1.txt'),
      [URLS.leadharborPricing]: page('leadharbor-pricing-v1.txt'),
      [URLS.salesyardPricing]: page('salesyard-pricing-v1.txt'),
    },
    searches: [
      { match: 'pipeloom', results: [hit(URLS.pipeloomPricing, null, 'pipeloom-pricing-v1.txt', 'Pipeloom pricing')] },
      { match: 'dealbase', results: [hit(URLS.dealbasePricing, null, 'dealbase-pricing-v1.txt', 'Dealbase pricing')] },
      { match: 'closewise', results: [hit(URLS.closewisePricing, null, 'closewise-pricing-v1.txt', 'Closewise pricing')] },
      { match: 'leadharbor', results: [hit(URLS.leadharborPricing, null, 'leadharbor-pricing-v1.txt', 'Leadharbor pricing')] },
      { match: 'salesyard', results: [hit(URLS.salesyardPricing, null, 'salesyard-pricing-v1.txt', 'Salesyard pricing')] },
    ],
  };
}

/** Case 13: Basalt Pro page states an annual price only. */
export function scenarioBasaltAnnual(): FixtureScenario {
  return {
    pages: {
      [URLS.northwindPricing]: page('northwind-pricing-v1.txt'),
      [URLS.basaltPricing]: page('basalt-pricing-v2-annual.txt'),
    },
    searches: [
      { match: 'basalt', results: [hit(URLS.basaltPricing, null, 'basalt-pricing-v2-annual.txt', 'Basalt DB pricing')] },
      { match: 'northwind', results: [hit(URLS.northwindPricing, null, 'northwind-pricing-v1.txt', 'Northwind PG pricing')] },
    ],
  };
}

/** Case 14: Basalt Pro is reworded; the seeded sentence is gone. */
export function scenarioBasaltReword(): FixtureScenario {
  return {
    pages: {
      [URLS.northwindPricing]: page('northwind-pricing-v1.txt'),
      [URLS.basaltPricing]: page('basalt-pricing-v2-reword.txt'),
    },
    searches: [
      { match: 'basalt', results: [hit(URLS.basaltPricing, null, 'basalt-pricing-v2-reword.txt', 'Basalt DB pricing')] },
      { match: 'northwind', results: [hit(URLS.northwindPricing, null, 'northwind-pricing-v1.txt', 'Northwind PG pricing')] },
    ],
  };
}

/** Case 15: the blog still says 19. The vendor page says 24. */
export function scenarioThirdParty(): FixtureScenario {
  return {
    pages: {
      [URLS.thirdPartyBlog]: page('thirdparty-blog-v2.txt'),
      [URLS.northwindPricing]: page('northwind-pricing-v2.txt'),
      [URLS.basaltPricing]: page('basalt-pricing-v2.txt'),
    },
    searches: [
      { match: 'northwind', results: [hit(URLS.northwindPricing, '2026-11-12T06:00:00.000Z', 'northwind-pricing-v2.txt', 'Northwind PG pricing')] },
      { match: 'basalt', results: [hit(URLS.basaltPricing, null, 'basalt-pricing-v2.txt', 'Basalt DB pricing')] },
    ],
  };
}

/** Case 16: the Northwind fetch times out. Search has nothing on or after 10 Nov. */
export function scenarioNorthwindTimeout(): FixtureScenario {
  return {
    pages: {
      [URLS.northwindPricing]: { failure: 'timeout' },
      [URLS.basaltPricing]: page('basalt-pricing-v2.txt'),
    },
    searches: [
      { match: 'northwind', results: [] },
      { match: 'basalt', results: [hit(URLS.basaltPricing, null, 'basalt-pricing-v2.txt', 'Basalt DB pricing')] },
    ],
  };
}

/** No pages. Used when a case should not fetch anything. */
export function scenarioEmpty(): FixtureScenario {
  return { pages: {}, searches: [] };
}
