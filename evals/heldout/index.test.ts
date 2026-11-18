import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { containsQuote } from '../../src/core/search/quote';
import { createStore } from '../../src/core/store/index';
import { FakeClock } from '../../src/core/testing/fakes';
import { formatLocalDate, numbersIn } from '../assert';
import { FixtureSearch, type FixtureCall, type FixtureScenario } from '../fixtureSearch';
import { CLOCK, TZ } from '../types';
import { HELDOUT_CASES } from './index';
import { hearthmailScenario } from './scenarios';
import { servedEvidence } from './served';

const heldoutDir = join(import.meta.dirname, '.');

describe('held-out cases', () => {
  it('is ids 101 through 119, each once', () => {
    const ids = HELDOUT_CASES.map((item) => item.id);
    expect(ids).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119]);
  });

  it('gives every case a message', () => {
    for (const item of HELDOUT_CASES) {
      expect(item.parts.length).toBeGreaterThan(0);
      expect(item.parts.every((part) => part.messages.length > 0)).toBe(true);
      expect(item.parts.every((part) => part.seeds.length === 0)).toBe(true);
    }
  });

  it('stores quotes that contain their values and sit inside the source text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'minimi-heldout-seed-'));
    const store = createStore(join(dir, 'store.db'), new FakeClock(CLOCK), defaultConfig);
    for (const item of HELDOUT_CASES) {
      for (const part of item.parts) part.prepare?.(store);
    }
    const hits = store.findTurns({ range: { from: '2026-11-01', to: '2026-11-30' }, excludeTurnIds: [], limit: 50 });
    const claims = store.claimsForTurns(
      hits.flatMap((hit) => (hit.assistantTurn === null ? [] : [hit.assistantTurn.id])),
      'as_stated',
    );
    expect(claims.length).toBe(16);
    for (const claim of claims) {
      const source = store.getSources([claim.sourceId])[0];
      expect(source).toBeDefined();
      expect(containsQuote(source?.text ?? '', claim.quote)).toBe(true);
      const quoted = new Set(numbersIn(claim.quote).map(Number));
      for (const token of numbersIn(claim.value)) expect(quoted.has(Number(token))).toBe(true);
    }
    const blog = claims.find((claim) => claim.entity === 'Hearthmail');
    const blogSource = store.getSources([blog?.sourceId ?? ''])[0];
    expect(blogSource?.firstParty).toBe(false);
    expect(blogSource?.url).toBe('https://reviewdesk.test/notes/hearthmail');
    const vendor = claims.find((claim) => claim.entity === 'Ivyledger');
    const vendorSource = store.getSources([vendor?.sourceId ?? ''])[0];
    expect(vendorSource?.firstParty).toBe(true);
    expect(vendorSource?.url).toBe('https://ivyledger.test/pricing');
    const loomery = claims.find((claim) => claim.entity === 'Loomery');
    const palletory = claims.find((claim) => claim.entity === 'Palletory');
    expect(loomery?.turnId).toBeDefined();
    expect(loomery?.turnId).toBe(palletory?.turnId);
    const cinderwell = claims.find((claim) => claim.entity === 'Cinderwell');
    expect(formatLocalDate(cinderwell?.asOfUtc ?? '', TZ)).toBe('2026-11-10');
    expect(formatLocalDate(cinderwell?.lastVerifiedAtUtc ?? '', TZ)).toBe('2026-11-06');
    const fifth = store.findTurns({ dates: ['2026-11-05'], excludeTurnIds: [], limit: 50 });
    expect(fifth.some((hit) => hit.userTurn.content === 'Where is the spare kiln key kept?')).toBe(true);
    expect(Object.keys(hearthmailScenario.pages)).toEqual(['https://reviewdesk.test/notes/hearthmail']);
    expect(hearthmailScenario.searches.flatMap((entry) => entry.results.map((result) => result.url))).toEqual([
      'https://reviewdesk.test/notes/hearthmail',
    ]);
  });

  it('serves a held-out page from inline text', async () => {
    const search = new FixtureSearch(new FakeClock(CLOCK), {
      pages: { 'https://lumenboard.test/pricing': { text: 'Lumenboard Studio is 36 USD per month.' } },
      searches: [],
    });
    const page = await search.fetchPage({ url: 'https://lumenboard.test/pricing', deadlineMs: 1000 });
    expect(page.status).toBe('ok');
    expect(page.live).toBe(true);
    expect(page.text).toContain('36 USD per month');
  });

  it('licenses kept news and fetched inline text, not a dropped or failed page', () => {
    const scenario: FixtureScenario = {
      pages: {
        'https://loomery.test/changelog': { text: '12 Nov 2026: Loomery shipped shared drafts.' },
        'https://cinderwell.test/pricing': { failure: 'timeout' },
      },
      searches: [
        {
          match: 'loomery news',
          results: [
            {
              url: 'https://loomery.test/changelog',
              title: 'loomery.test',
              publishedAt: '2026-11-12T04:00:00.000Z',
              text: '12 Nov 2026: Loomery shipped shared drafts.',
            },
          ],
        },
        {
          match: 'palletory news',
          results: [
            {
              url: 'https://palletory.test/changelog',
              title: 'palletory.test',
              publishedAt: '2026-11-02T04:00:00.000Z',
              text: '2 Nov 2026: Palletory added barcode labels.',
            },
          ],
        },
        {
          match: 'undated news',
          results: [
            {
              url: 'https://loomery.test/changelog',
              title: 'loomery.test',
              publishedAt: null,
              text: 'Undated note.',
            },
          ],
        },
      ],
    };
    const calls: FixtureCall[] = [
      { kind: 'search', query: 'Loomery news', numResults: 5, publishedOnOrAfter: '2026-11-09' },
      { kind: 'search', query: 'Palletory news', numResults: 5, publishedOnOrAfter: '2026-11-09' },
      { kind: 'search', query: 'undated news', numResults: 5, publishedOnOrAfter: '2026-11-09' },
      { kind: 'fetchPage', url: 'https://loomery.test/changelog', deadlineMs: 1000 },
      { kind: 'fetchPage', url: 'https://cinderwell.test/pricing', deadlineMs: 1000 },
    ];
    const texts = servedEvidence(scenario, calls, TZ).join('\n');
    expect(texts).toContain('shared drafts');
    expect(texts).not.toContain('barcode');
    expect(texts).not.toContain('Undated');
  });

  it('does not reuse the scripted set\'s vendors or the 3/11 date', () => {
    const banned = ['northwind', 'basalt', 'pipeloom', 'dealbase', 'closewise', 'leadharbor', 'salesyard', 'thirdparty.test', '3/11'];
    const files = readdirSync(heldoutDir).filter((name) => name !== 'index.test.ts');
    const body = files.map((name) => readFileSync(join(heldoutDir, name), 'utf8')).join('\n').toLowerCase();
    for (const word of banned) expect(body).not.toContain(word);
  });
});
