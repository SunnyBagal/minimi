import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Claim, ContainsQuote, FetchedPage, JudgeOutput } from '../contracts';
import { claimFixture } from '../testing/fakes';
import { guardVerdict } from './guards';

const NOW = '2026-11-10T20:00:00.000Z';
const PAGE_TEXT = 'The Basic plan costs $25.00 per month, billed in USD.';
const QUOTE = 'costs $25.00 per month';

/** A stub containsQuote: plain substring, the simplest honest check. */
const containsQuote: ContainsQuote = (haystack, quote) => haystack.includes(quote);

function page(overrides: Partial<FetchedPage> = {}): FetchedPage {
  return {
    url: 'https://example.test/pricing',
    finalUrl: 'https://example.test/pricing',
    status: 'ok',
    httpStatus: 200,
    title: 'Pricing',
    text: PAGE_TEXT,
    fetchedAtUtc: NOW,
    live: true,
    ...overrides,
  };
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return claimFixture({ value: '25 USD/month', scope: { period: 'month', currency: 'USD' }, ...overrides });
}

function output(overrides: Partial<JudgeOutput> = {}): JudgeOutput {
  return {
    verdict: 'changed',
    newValue: '30 USD/month',
    quote: QUOTE,
    quoteUrl: 'https://example.test/pricing',
    scope: { period: 'month', currency: 'USD' },
    reason: 'The price rose.',
    ...overrides,
  };
}

function decide(judge: JudgeOutput, ctx: { page?: FetchedPage | null; claim?: Claim; containsQuote?: ContainsQuote } = {}) {
  return guardVerdict(judge, {
    claim: ctx.claim ?? claim(),
    page: ctx.page === undefined ? page() : ctx.page,
    fresh: [],
    now: new Date(NOW),
    containsQuote: ctx.containsQuote ?? containsQuote,
  });
}

describe('guard acceptance lines', () => {
  it('changed with no quote becomes unverifiable', () => {
    const d = decide(output({ quote: null }));
    expect(d.verdict).toBe('unverifiable');
    expect(d.decidedBy).toBe('guard');
  });

  it('changed with a quote that is not in the fetched text becomes unverifiable', () => {
    const d = decide(output({ quote: 'costs €99 per year' }));
    expect(d.verdict).toBe('unverifiable');
    expect(d.decidedBy).toBe('guard');
    expect(d.reason).toContain('quote');
  });

  it('unchanged from a page with live = false becomes source_unavailable', () => {
    const d = decide(output({ verdict: 'unchanged', newValue: null }), { page: page({ live: false }) });
    expect(d.verdict).toBe('source_unavailable');
    expect(d.decidedBy).toBe('guard');
    expect(d.reason.toLowerCase()).toContain('cache');
  });

  it('changed from a page with status timeout becomes source_unavailable', () => {
    const d = decide(output(), { page: page({ status: 'timeout', httpStatus: null, text: '' }) });
    expect(d.verdict).toBe('source_unavailable');
    expect(d.decidedBy).toBe('guard');
    expect(d.reason).toContain('timeout');
  });

  it('claim period month, judge scope period year: unverifiable, and the reason names both', () => {
    const d = decide(output({ scope: { period: 'year' } }));
    expect(d.verdict).toBe('unverifiable');
    expect(d.decidedBy).toBe('guard');
    expect(d.reason).toContain('month');
    expect(d.reason).toContain('year');
  });

  it('changed with newValue "24" and a quote that does not contain 24: unverifiable', () => {
    const d = decide(output({ newValue: '24' }));
    expect(d.verdict).toBe('unverifiable');
    expect(d.decidedBy).toBe('guard');
  });

  it('changed with newValue "$25.00 per month" against claim value "25 USD/month", same scope: unchanged, decidedBy guard', () => {
    const d = decide(output({ newValue: '$25.00 per month' }));
    expect(d.verdict).toBe('unchanged');
    expect(d.newValue).toBeNull();
    expect(d.decidedBy).toBe('guard');
  });

  it('a valid changed and a valid unchanged pass through with decidedBy judge', () => {
    const changed = decide(output({ newValue: '24 USD/month', quote: 'costs 24 per month' }), {
      page: page({ text: 'Now it costs 24 per month.' }),
    });
    expect(changed.verdict).toBe('changed');
    expect(changed.newValue).toBe('24 USD/month');
    expect(changed.newQuote).toBe('costs 24 per month');
    expect(changed.decidedBy).toBe('judge');

    const unchanged = decide(output({ verdict: 'unchanged', newValue: 'ignored', quote: QUOTE }));
    expect(unchanged.verdict).toBe('unchanged');
    expect(unchanged.newValue).toBeNull();
    expect(unchanged.decidedBy).toBe('judge');
  });

  it('guards.ts imports nothing except types from contracts.ts', () => {
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'guards.ts'), 'utf8');
    const importLines = source.split('\n').filter((line) => /^import\s/.test(line));
    expect(importLines.length).toBe(1);
    expect(importLines[0]).toMatch(/^import type \{[^}]+\} from '\.\.\/contracts';/);
  });
});

describe('each rule fires before later ones', () => {
  it('rule 1: judge unverifiable with page null stays unverifiable/judge', () => {
    const d = decide(output({ verdict: 'unverifiable', quote: null }), { page: null });
    expect(d.verdict).toBe('unverifiable');
    expect(d.decidedBy).toBe('judge');
  });

  it('rule 1: judge source_unavailable with a perfect page passes through', () => {
    const d = decide(output({ verdict: 'source_unavailable', quote: QUOTE }));
    expect(d.verdict).toBe('source_unavailable');
    expect(d.decidedBy).toBe('judge');
  });

  it('rule 2: page timeout AND no quote → source_unavailable, not unverifiable', () => {
    const d = decide(output({ quote: null }), { page: page({ status: 'timeout', text: '' }) });
    expect(d.verdict).toBe('source_unavailable');
    expect(d.decidedBy).toBe('guard');
  });

  it('rule 3: live false AND quote missing → source_unavailable with cache reason', () => {
    const d = decide(output({ quote: null }), { page: page({ live: false }) });
    expect(d.verdict).toBe('source_unavailable');
    expect(d.reason.toLowerCase()).toContain('cache');
  });

  it('rule 4: quote missing AND scope mismatch → quote reason', () => {
    const d = decide(output({ quote: null, scope: { period: 'year' } }));
    expect(d.verdict).toBe('unverifiable');
    expect(d.reason).toContain('quote');
  });

  it('rule 5: scope mismatch AND changed with blank newValue → scope reason', () => {
    const d = decide(output({ scope: { period: 'year' }, newValue: '' }));
    expect(d.verdict).toBe('unverifiable');
    expect(d.reason).toContain('year');
    expect(d.reason).toContain('month');
  });

  it('rule 6: changed with blank newValue → unverifiable', () => {
    const d = decide(output({ newValue: '  ' }));
    expect(d.verdict).toBe('unverifiable');
    expect(d.decidedBy).toBe('guard');
  });

  it('rule 7: changed whose newValue equals the claim value → unchanged by guard', () => {
    const d = decide(output({ newValue: '25.0 USD/month' }));
    expect(d.verdict).toBe('unchanged');
    expect(d.decidedBy).toBe('guard');
  });

  it('rule 8: a clean changed verdict passes through', () => {
    const d = decide(output({ newValue: '24 USD/month', quote: 'costs 24 per month' }), {
      page: page({ text: 'Now it costs 24 per month.' }),
    });
    expect(d.verdict).toBe('changed');
    expect(d.decidedBy).toBe('judge');
  });
});

describe('guard never upgrades and reasons are readable', () => {
  it('never upgrades: judge unverifiable with a perfect page stays unverifiable', () => {
    const d = decide(output({ verdict: 'unverifiable', quote: QUOTE }));
    expect(d.verdict).toBe('unverifiable');
  });

  it('values with no number compare as text: "Unlimited" vs "unlimited  " → unchanged', () => {
    const d = decide(output({ newValue: 'unlimited  ', quote: 'plans are unlimited' }), {
      claim: claim({ value: 'Unlimited' }),
      page: page({ text: 'all plans are unlimited forever' }),
    });
    expect(d.verdict).toBe('unchanged');
    expect(d.decidedBy).toBe('guard');
  });

  it('thousands separator: "1,200" vs "1200" → unchanged', () => {
    const d = decide(output({ newValue: '1,200 seats', quote: '1200 seats' }), {
      claim: claim({ value: '1200 seats' }),
      page: page({ text: 'Up to 1200 seats included.' }),
    });
    expect(d.verdict).toBe('unchanged');
    expect(d.decidedBy).toBe('guard');
  });

  it('every decision has a non-empty single-sentence reason', () => {
    const inputs: [JudgeOutput, { page?: FetchedPage | null }][] = [
      [output({ verdict: 'unverifiable' }), { page: null }],
      [output(), { page: null }],
      [output(), { page: page({ status: 'timeout' }) }],
      [output(), { page: page({ live: false }) }],
      [output({ quote: null }), {}],
      [output({ scope: { currency: 'EUR' } }), {}],
      [output({ newValue: '' }), {}],
      [output({ newValue: '25 USD/month' }), {}],
      [output({ verdict: 'unchanged', newValue: null }), {}],
      [output({ reason: '' }), {}],
    ];
    for (const [judge, ctx] of inputs) {
      const d = decide(judge, ctx);
      expect(d.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('calls containsQuote only when an earlier rule did not decide', () => {
    const spy = vi.fn(containsQuote);
    decide(output({ quote: null }), { page: page({ status: 'timeout' }), containsQuote: spy });
    expect(spy).not.toHaveBeenCalled();
    decide(output(), { containsQuote: spy });
    expect(spy).toHaveBeenCalledWith(PAGE_TEXT, QUOTE);
  });
});
