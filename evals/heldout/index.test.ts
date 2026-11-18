import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { containsQuote } from '../../src/core/search/quote';
import { createStore } from '../../src/core/store/index';
import { FakeClock } from '../../src/core/testing/fakes';
import { numbersIn } from '../assert';
import { FixtureSearch } from '../fixtureSearch';
import { CLOCK } from '../types';
import { HELDOUT_CASES } from './index';

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

  it('does not reuse the scripted set\'s vendors or the 3/11 date', () => {
    const banned = ['northwind', 'basalt', 'pipeloom', 'dealbase', 'closewise', 'leadharbor', 'salesyard', 'thirdparty.test', '3/11'];
    const files = readdirSync(heldoutDir).filter((name) => name !== 'index.test.ts');
    const body = files.map((name) => readFileSync(join(heldoutDir, name), 'utf8')).join('\n').toLowerCase();
    for (const word of banned) expect(body).not.toContain(word);
  });
});
