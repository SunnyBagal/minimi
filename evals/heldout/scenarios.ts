/**
 * Fixture scenarios for the held-out cases. Search match is a case-insensitive
 * substring of the query; the first match wins.
 */
import type { FixtureScenario, FixtureSearchHit } from '../fixtureSearch';
import {
  BRASSLINE_PRICING,
  BRASSLINE_V2,
  CINDERWELL_PRICING,
  FERNLEDGER_PAGE,
  FERNLEDGER_PRICING,
  HEARTHMAIL_BLOG,
  HEARTHMAIL_PRICING,
  HEARTHMAIL_V2,
  IVYLEDGER_PAGE,
  IVYLEDGER_PRICING,
  KILNNOTE_HELP,
  KILNNOTE_PAGE,
  LOOMERY_CHANGELOG,
  LOOMERY_NEWS,
  LOOMERY_PAGE,
  LOOMERY_PRICING,
  LUMENBOARD_PAGE,
  LUMENBOARD_PRICING,
  NIMBUSMAIL_PRICING,
  NIMBUSMAIL_V2,
  ORCHARDPAY_PAGE,
  ORCHARDPAY_PRICING,
  PALLETORY_CHANGELOG,
  PALLETORY_OLD_NEWS,
  PALLETORY_PAGE,
  PALLETORY_PRICING,
  REVIEWDESK_NOTE,
  ROWANHOST_PAGE,
  ROWANHOST_PRICING,
  VELLUMSTACK_PRICING,
  VELLUMSTACK_V2,
} from './pages';

export const emptyScenario: FixtureScenario = { pages: {}, searches: [] };

function hit(url: string, text: string, publishedAt: string | null = null): FixtureSearchHit['results'][number] {
  return { url, title: new URL(url).hostname, publishedAt, text };
}

/** One live page, returned for any query that contains `match`. */
export function pageScenario(url: string, text: string, match: string): FixtureScenario {
  return {
    pages: { [url]: { text } },
    searches: [{ match, results: [hit(url, text)] }],
  };
}

export const lumenboardScenario = pageScenario(LUMENBOARD_PRICING, LUMENBOARD_PAGE, 'lumenboard');
export const orchardpayScenario = pageScenario(ORCHARDPAY_PRICING, ORCHARDPAY_PAGE, 'orchardpay');
export const kilnnoteScenario = pageScenario(KILNNOTE_HELP, KILNNOTE_PAGE, 'kilnnote');
export const nimbusmailScenario = pageScenario(NIMBUSMAIL_PRICING, NIMBUSMAIL_V2, 'nimbusmail');
export const rowanhostScenario = pageScenario(ROWANHOST_PRICING, ROWANHOST_PAGE, 'rowanhost');
export const fernledgerScenario = pageScenario(FERNLEDGER_PRICING, FERNLEDGER_PAGE, 'fernledger');
export const ivyledgerScenario = pageScenario(IVYLEDGER_PRICING, IVYLEDGER_PAGE, 'ivyledger');
export const brasslineScenario = pageScenario(BRASSLINE_PRICING, BRASSLINE_V2, 'brassline');
export const vellumstackScenario = pageScenario(VELLUMSTACK_PRICING, VELLUMSTACK_V2, 'vellumstack');

/** The pricing URL times out and search finds nothing. */
export const cinderwellScenario: FixtureScenario = {
  pages: { [CINDERWELL_PRICING]: { failure: 'timeout' } },
  searches: [{ match: 'cinderwell', results: [] }],
};

/**
 * The stored quote lives on a review site. The vendor page has the new price.
 * A query that names the product returns the vendor page.
 */
export const hearthmailScenario: FixtureScenario = {
  pages: {
    [REVIEWDESK_NOTE]: { text: HEARTHMAIL_BLOG },
    [HEARTHMAIL_PRICING]: { text: HEARTHMAIL_V2 },
  },
  searches: [{ match: 'hearthmail', results: [hit(HEARTHMAIL_PRICING, HEARTHMAIL_V2)] }],
};

/**
 * Pricing pages are unchanged. News search is `${entity} news`.
 * The Loomery post is dated 12 Nov; the Palletory post is dated 2 Nov.
 */
export const newsScenario: FixtureScenario = {
  pages: {
    [LOOMERY_PRICING]: { text: LOOMERY_PAGE },
    [PALLETORY_PRICING]: { text: PALLETORY_PAGE },
    [LOOMERY_CHANGELOG]: { text: LOOMERY_NEWS },
    [PALLETORY_CHANGELOG]: { text: PALLETORY_OLD_NEWS },
  },
  searches: [
    {
      match: 'loomery news',
      results: [hit(LOOMERY_CHANGELOG, LOOMERY_NEWS, '2026-11-12T04:00:00.000Z')],
    },
    {
      match: 'palletory news',
      results: [hit(PALLETORY_CHANGELOG, PALLETORY_OLD_NEWS, '2026-11-02T04:00:00.000Z')],
    },
    { match: 'loomery', results: [hit(LOOMERY_PRICING, LOOMERY_PAGE)] },
    { match: 'palletory', results: [hit(PALLETORY_PRICING, PALLETORY_PAGE)] },
  ],
};
