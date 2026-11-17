import { describe, expect, it } from 'vitest';
import type { AgentEvent, Claim, SearchResult, SourceRef } from '../contracts';
import { rememberEvidence } from './evidence';
import { assistantTurn, claim, config, lastAssistant, plan, rig, source, textOf, types, userTurn } from './testSupport';

const NEON_PAGE = 'https://neon.test/pricing';
const NEON_HIT: SearchResult = {
  url: NEON_PAGE,
  title: 'Neon pricing',
  publishedAt: null,
  text: 'The Launch plan costs 19 USD per month. [1]',
};

function verdicts(events: AgentEvent[]) {
  return events.filter((e) => e.type === 'verdict').map((e) => e.row);
}

/** Seeds a stored question/answer pair on 9 Nov with the given claims. */
function storedAnswer(r: ReturnType<typeof rig>, claims: { entity?: string; attribute?: string; value?: string; quote?: string; url?: string; firstParty?: boolean; pageText?: string }[]) {
  const user = userTurn(r.store, { content: 'What does Neon Launch cost?', localDate: '2026-11-09' });
  const answer = assistantTurn(r.store, { localDate: '2026-11-09' });
  const refs: SourceRef[] = [];
  for (const spec of claims) {
    const src = source(r.store, {
      url: spec.url ?? NEON_PAGE,
      firstParty: spec.firstParty ?? true,
      text: spec.pageText ?? spec.quote ?? 'The Launch plan costs 19 USD per month.',
    });
    claim(r.store, answer.id, src.id, {
      entity: spec.entity ?? 'Neon',
      attribute: spec.attribute ?? 'price',
      value: spec.value ?? '19 USD/month',
      quote: spec.quote ?? 'costs 19 USD per month',
    });
    refs.push({
      n: refs.length + 1,
      sourceId: src.id,
      url: src.url,
      title: src.title,
      fetchedAtUtc: src.fetchedAtUtc,
      live: src.live,
      firstParty: src.firstParty,
      text: src.text,
    });
  }
  rememberEvidence(r.store, answer.id, refs);
  return { user, answer };
}

function recheckRig(options: Parameters<typeof rig>[0] = {}) {
  return rig({
    ...options,
    llm: {
      route: plan({ intent: 'recheck', refersToPrevious: true }),
      write: ['Summary [1].'],
      ...options.llm,
    },
    search: { results: {}, pages: {}, ...options.search },
  });
}

describe('recheck', () => {
  it('event order: recheck (recall, one verdict per claim, text, done)', async () => {
    const r = recheckRig();
    storedAnswer(r, [{}]);
    const events = await r.run({ message: 'is that still right?' });
    const nonTiming = types(events, ['timing', 'status']);
    expect(nonTiming[0]).toBe('recall');
    expect(nonTiming.filter((t) => t === 'verdict')).toHaveLength(1);
    expect(nonTiming.at(-1)).toBe('done');
    // Every verdict lands before the summary text (the last text event).
    expect(nonTiming.lastIndexOf('verdict')).toBeLessThan(nonTiming.lastIndexOf('text'));
  });

  it('five claims on one URL cause one fetchPage', async () => {
    const r = recheckRig({
      search: { pages: { [NEON_PAGE]: { status: 'ok', live: true, text: 'costs 19 USD per month' } } },
    });
    storedAnswer(r, [{ attribute: 'a' }, { attribute: 'b' }, { attribute: 'c' }, { attribute: 'd' }, { attribute: 'e' }]);
    const events = await r.run({ message: 'is that still right?' });
    expect(r.search.fetchCalls.filter((call) => call.url === NEON_PAGE)).toHaveLength(1);
    // Five claims backed by one page cite that numbered source once.
    const citations = events.find((e) => e.type === 'citations');
    if (citations === undefined || citations.type !== 'citations') throw new Error('no citations');
    expect(citations.items).toHaveLength(1);
  });

  it('a first-party live page with the quote present takes the fast path and makes no judge call', async () => {
    const r = recheckRig({
      search: { pages: { [NEON_PAGE]: { status: 'ok', live: true, text: 'The Launch plan costs 19 USD per month.' } } },
    });
    storedAnswer(r, [{}]);
    const events = await r.run({ message: 'check it' });
    const rows = verdicts(events);
    expect(rows[0]?.check.decidedBy).toBe('fast_path');
    expect(rows[0]?.check.verdict).toBe('unchanged');
    expect(r.llm.calls('judge')).toHaveLength(0);
  });

  it('a third-party source never takes the fast path', async () => {
    const r = recheckRig({
      search: { pages: { [NEON_PAGE]: { status: 'ok', live: true, text: 'costs 19 USD per month' } } },
    });
    storedAnswer(r, [{ firstParty: false }]);
    const events = await r.run({ message: 'check it' });
    expect(verdicts(events)[0]?.check.decidedBy).not.toBe('fast_path');
    expect(r.llm.calls('judge')).toHaveLength(1);
  });

  it('a page with live: false never yields a fast-path unchanged', async () => {
    const r = recheckRig({
      search: { pages: { [NEON_PAGE]: { status: 'ok', live: false, text: 'costs 19 USD per month' } } },
    });
    storedAnswer(r, [{}]);
    const events = await r.run({ message: 'check it' });
    expect(verdicts(events)[0]?.check.decidedBy).not.toBe('fast_path');
  });

  it('extraction on demand: a re-check of a turn whose extraction is pending still returns verdicts', async () => {
    const r = recheckRig({
      llm: {
        extractClaims: [
          { entity: 'Neon', attribute: 'price', value: '19 USD', scope: {}, quote: 'costs 19 USD per month', volatility: 'high', sourceN: 1 },
        ],
      },
      search: { pages: { [NEON_PAGE]: { status: 'ok', live: true, text: 'costs 19 USD per month' } } },
    });
    // A stored answer whose extraction never ran: pending, with known evidence.
    userTurn(r.store, { content: 'Neon pricing?', localDate: '2026-11-09' });
    const answer = assistantTurn(r.store, { localDate: '2026-11-09', extraction: 'pending', content: 'It costs 19 USD [1].' });
    const src = source(r.store, { url: NEON_PAGE, firstParty: true, text: 'costs 19 USD per month' });
    rememberEvidence(r.store, answer.id, [
      { n: 1, sourceId: src.id, url: src.url, title: src.title, fetchedAtUtc: src.fetchedAtUtc, live: src.live, firstParty: src.firstParty, text: src.text },
    ]);
    const events = await r.run({ message: 'is that still right?' });
    expect(verdicts(events)).toHaveLength(1);
    expect(r.store.getTurns([answer.id])[0]?.extraction).toBe('done');
    expect(r.store.allClaims()).toHaveLength(1);
  });

  it('extraction on demand sends only the cited evidence to the extractor', async () => {
    const r = recheckRig({
      llm: {
        extractClaims: [
          { entity: 'Neon', attribute: 'price', value: '19 USD', scope: {}, quote: 'costs 19 USD per month', volatility: 'high', sourceN: 2 },
        ],
      },
      search: { pages: { [NEON_PAGE]: { status: 'ok', live: true, text: 'costs 19 USD per month' } } },
    });
    userTurn(r.store, { content: 'Neon pricing?', localDate: '2026-11-09' });
    const answer = assistantTurn(r.store, {
      localDate: '2026-11-09',
      extraction: 'pending',
      content: 'It costs 19 USD [2].',
    });
    const other = source(r.store, { url: 'https://neon.test/other', firstParty: true, text: 'Other page.' });
    const src = source(r.store, { url: NEON_PAGE, firstParty: true, text: 'costs 19 USD per month' });
    // The answer cites [2], the second of its two evidence items.
    const refs = [other, src].map((s, index) => ({
      n: index + 1,
      sourceId: s.id,
      url: s.url,
      title: s.title,
      fetchedAtUtc: s.fetchedAtUtc,
      live: s.live,
      firstParty: s.firstParty,
      text: s.text,
    }));
    rememberEvidence(r.store, answer.id, refs);
    await r.run({ message: 'is that still right?' });
    const calls = r.llm.calls('extractClaims');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input.evidence.map((item) => item.n)).toEqual([2]);
  });

  // Eval case 19: a dated re-check changes one of three claims; the follow-up
  // "is that still right?" re-checks the report; a second dated re-check must
  // not write a second superseding claim. One session, three turns.
  const DATED_MSG = 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?';
  const FOLLOWUP_MSG = 'Is that still right?';
  const NORTHWIND_PAGE = 'https://northwindpg.test/pricing';
  const BASALT_PRO_PAGE = 'https://basaltdb.test/pricing';
  const BASALT_FREE_PAGE = 'https://basaltdb.test/free';
  const LAST_TUESDAY = { kind: 'weekday', weekday: 2, modifier: 'last' } as const;

  async function runCase19() {
    const r = rig({
      timeTable: [
        {
          ref: { ...LAST_TUESDAY },
          result: { dates: ['2026-11-10', '2026-11-03'], range: null, ambiguous: true, rule: 'last Tuesday' },
        },
      ],
      llm: {
        route: (input) =>
          input.message === DATED_MSG
            ? plan({ intent: 'recheck', timeRef: { ...LAST_TUESDAY }, topic: 'Postgres hosting' })
            : plan({ intent: 'recheck', refersToPrevious: true }),
        write: ['Summary [1].'],
        judge: (input) =>
          input.claim.value.includes('19')
            ? {
                verdict: 'changed' as const,
                newValue: '24 USD/month',
                quote: 'Starter: 24 USD per month',
                quoteUrl: NORTHWIND_PAGE,
                scope: {},
                reason: 'The Starter price changed.',
              }
            : {
                verdict: 'unchanged' as const,
                newValue: null,
                quote: input.claim.quote,
                quoteUrl: null,
                scope: input.claim.scope,
                reason: 'The value still matches.',
              },
      },
      search: {
        pages: {
          [NORTHWIND_PAGE]: { status: 'ok', live: true, text: 'Starter: 24 USD per month' },
          [BASALT_PRO_PAGE]: { status: 'ok', live: true, text: 'Pro: 25 USD per month' },
          [BASALT_FREE_PAGE]: { status: 'ok', live: true, text: 'Free tier: 1 project' },
        },
      },
    });
    // The seeded fresh answer on 10 Nov, three first-party claims.
    userTurn(r.store, { content: 'Compare Postgres hosting prices.', localDate: '2026-11-10', topic: 'Postgres hosting' });
    const answer = assistantTurn(r.store, { localDate: '2026-11-10', topic: 'Postgres hosting' });
    const northSource = source(r.store, { url: NORTHWIND_PAGE, firstParty: true, text: 'Starter: 19 USD per month' });
    const proSource = source(r.store, { url: BASALT_PRO_PAGE, firstParty: true, text: 'Pro: 25 USD per month' });
    const freeSource = source(r.store, { url: BASALT_FREE_PAGE, firstParty: true, text: 'Free tier: 1 project' });
    const northwind = claim(r.store, answer.id, northSource.id, {
      entity: 'Northwind PG',
      attribute: 'Starter price',
      value: '19 USD/month',
      quote: 'Starter: 19 USD per month',
    });
    claim(r.store, answer.id, proSource.id, {
      entity: 'Basalt DB',
      attribute: 'Pro price',
      value: '25 USD/month',
      quote: 'Pro: 25 USD per month',
    });
    claim(r.store, answer.id, freeSource.id, {
      entity: 'Basalt DB',
      attribute: 'free tier',
      value: '1 project',
      quote: 'Free tier: 1 project',
    });

    const turn1 = await r.run({ message: DATED_MSG });
    const turn2 = await r.run({ message: FOLLOWUP_MSG });
    const turn3 = await r.run({ message: DATED_MSG });
    return { store: r.store, answer, northwind, turn1, turn2, turn3 };
  }

  it('turn 1 (dated): Northwind row changed; exactly one superseding claim, value 24', async () => {
    const { store, northwind, turn1 } = await runCase19();
    const rows = verdicts(turn1);
    expect(rows).toHaveLength(3);
    const northwindRow = rows.find((row) => row.claim.entity === 'Northwind PG');
    expect(northwindRow?.check.verdict).toBe('changed');
    const superseding = store.allClaims().filter((c) => c.supersedesId !== null);
    expect(superseding).toHaveLength(1);
    expect(superseding[0]?.supersedesId).toBe(northwind.id);
    expect(superseding[0]?.value).toBe('24 USD/month');
  });

  it('follow-up after a report: "is that still right?" returns one row per original claim, and the changed claim\u2019s baseline is the new value', async () => {
    const { store, answer, turn2 } = await runCase19();
    const rows = verdicts(turn2);
    expect(rows).toHaveLength(3);
    const northwindRow = rows.find((row) => row.claim.entity === 'Northwind PG');
    expect(northwindRow?.claim.value).toContain('24');
    expect(northwindRow?.check.verdict).toBe('unchanged');
    const done = turn2.at(-1);
    if (done === undefined || done.type !== 'done') throw new Error('no done event');
    expect(done.intent).toBe('recheck');
    // The saved turn targets the seeded fresh answer, never the turn-1 re-check.
    const saved = store.getTurns([done.turnId])[0];
    expect(saved?.targetTurnIds).toEqual([answer.id]);
  });

  it('the dated question asked twice writes one superseding claim, not two', async () => {
    const { store, turn3 } = await runCase19();
    const northwindRow = verdicts(turn3).find((row) => row.claim.entity === 'Northwind PG');
    expect(northwindRow?.claim.value).toContain('19');
    expect(northwindRow?.check.verdict).toBe('changed');
    expect(northwindRow?.check.newValue).toContain('24');
    expect(store.allClaims().filter((c) => c.supersedesId !== null)).toHaveLength(1);
  });

  it('a re-check turn writes checks and no extracted claims; its saved turn has intent recheck and the original targets', async () => {
    const r = recheckRig();
    const { answer } = storedAnswer(r, [{}]);
    await r.run({ message: 'is that still right?' });
    expect(r.store.allChecks()).toHaveLength(1);
    expect(r.llm.calls('extractClaims')).toHaveLength(0);
    const saved = lastAssistant(r.store);
    expect(saved?.intent).toBe('recheck');
    expect(saved?.targetTurnIds).toEqual([answer.id]);
    expect(saved?.extraction).toBe('skipped');
  });

  it('wantsNews: a result dated before the chosen date is not passed as news; an undated one is counted', async () => {
    const NEWS = [
      { url: 'https://news.test/old', title: 'old', publishedAt: '2026-11-01T00:00:00.000Z', text: 'old news' },
      { url: 'https://news.test/new', title: 'new', publishedAt: '2026-11-15T00:00:00.000Z', text: 'new news' },
      { url: 'https://news.test/undated', title: 'undated', publishedAt: null, text: 'undated' },
    ];
    let newsInput: SourceRef[] | undefined;
    const r = recheckRig({
      llm: {
        route: plan({ intent: 'recheck', refersToPrevious: true, wantsNews: true }),
        write: (input) => {
          if (input.mode === 'recheck_summary') newsInput = input.news;
          return ['Summary.'];
        },
      },
      search: { results: { 'neon news': NEWS } },
    });
    storedAnswer(r, [{}]);
    const events = await r.run({ message: 'anything new since?' });
    expect(newsInput?.map((ref) => ref.url)).toEqual(['https://news.test/new']);
    expect(textOf(events)).toContain('1 undated search result(s) were set aside');
  });

  it('wantsNews searches one news query per baseline claim entity, not the router entities', async () => {
    const r = recheckRig({
      llm: {
        route: plan({ intent: 'recheck', refersToPrevious: true, wantsNews: true, entities: ['CRM'] }),
        write: ['Summary.'],
      },
      search: { results: { 'closewise news': [], 'leadharbor news': [] } },
    });
    storedAnswer(r, [
      { entity: 'Closewise', attribute: 'price', value: '12 USD' },
      { entity: 'Leadharbor', attribute: 'price', value: '15 USD' },
      { entity: 'Closewise', attribute: 'free tier', value: 'no' },
    ]);
    await r.run({ message: 'anything new since?' });
    const newsQueries = r.search.searchCalls.map((call) => call.query).filter((query) => query.endsWith(' news'));
    expect(newsQueries).toEqual(['Closewise news', 'Leadharbor news']);
  });

  it('the judge gets one retry on a rate-limit error', async () => {
    let judgeCalls = 0;
    const r = recheckRig({
      llm: {
        judge: () => {
          judgeCalls += 1;
          if (judgeCalls === 1) return Promise.reject(Object.assign(new Error('rate limit exceeded'), { statusCode: 429 }));
          return Promise.resolve({ verdict: 'unverifiable', newValue: null, quote: null, quoteUrl: null, scope: {}, reason: 'ok second time' });
        },
      },
    });
    storedAnswer(r, [{ firstParty: false }]);
    await r.run({ message: 'check' });
    expect(judgeCalls).toBe(2);
  });

  it('a judge failure produces an unverifiable row', async () => {
    const r = recheckRig({
      llm: { judge: () => Promise.reject(new Error('judge exploded')) },
    });
    storedAnswer(r, [{ firstParty: false }]);
    const events = await r.run({ message: 'check' });
    const rows = verdicts(events);
    expect(rows[0]?.check.verdict).toBe('unverifiable');
    expect(rows[0]?.provenance).toBe('could_not_verify');
  });

  it('claimsPerRecheck cap emits the skipped line', async () => {
    const r = rig({
      limits: { claimsPerRecheck: 1 },
      llm: { route: plan({ intent: 'recheck', refersToPrevious: true }), write: ['Summary.'] },
    });
    storedAnswer(r, [{ attribute: 'first' }, { attribute: 'second' }]);
    const events = await r.run({ message: 'check' });
    expect(textOf(events)).toContain('Skipped 1 lower-priority claim(s)');
    expect(verdicts(events)).toHaveLength(1);
  });

  it('the checked-at line appears before the summary', async () => {
    const r = recheckRig();
    storedAnswer(r, [{}]);
    const events = await r.run({ message: 'check' });
    expect(textOf(events)).toContain('Checked ');
  });
});
