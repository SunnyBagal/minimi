import { describe, expect, it } from 'vitest';
import type { WriteInput } from '../contracts';
import { lastAssistant, plan, rig, textOf, types } from './testSupport';

const HIT = {
  url: 'https://neon.test/pricing',
  title: 'Neon pricing',
  publishedAt: null,
  text: 'The Launch plan costs 19 USD per month.',
};

function freshRig(options: Parameters<typeof rig>[0] = {}) {
  return rig({
    ...options,
    llm: {
      route: plan({ intent: 'fresh', queries: ['neon launch pricing'], entities: ['Neon'] }),
      write: ['The Launch plan is 19 USD/month [1].'],
      ...options.llm,
    },
    search: { results: { '*': [HIT] }, ...options.search },
  });
}

describe('fresh', () => {
  it('event order: fresh', async () => {
    const { run } = freshRig();
    const events = await run({ message: 'what does Neon Launch cost?' });
    const tail = types(events).filter((t) => t !== 'status' && t !== 'timing');
    expect(tail).toEqual(['text', 'citations', 'flags', 'done']);
    const citations = events.find((e) => e.type === 'citations');
    if (citations === undefined || citations.type !== 'citations') throw new Error('no citations');
    expect(citations.items[0]?.url).toBe(HIT.url);
  });

  it('sources are saved before the first write call', async () => {
    const { run, store, llm } = freshRig();
    await run({ message: 'q' });
    const writeCall = llm.calls('write')[0]?.input;
    expect(writeCall?.mode).toBe('fresh');
    if (writeCall === undefined || writeCall.mode !== 'fresh') throw new Error('not fresh');
    expect(writeCall.evidence.length).toBe(1);
    expect(store.allSources().length).toBe(1);
  });

  const EXTRA_HIT = { url: 'https://neon.test/extra', title: 'Extra', publishedAt: null, text: 'Extra detail.' };

  it('tool cap: searchMore twice → one provider search, second call gets []', async () => {
    const { run, search, llm } = freshRig({
      llm: { searchMore: ['extra one', 'extra two'] },
      search: { results: { '*': [HIT], extra: [EXTRA_HIT] } },
    });
    await run({ message: 'q' });
    // One plan query + one tool search; the second searchMore returns [].
    expect(search.searchCalls).toHaveLength(2);
    expect(llm.searchMoreResults).toHaveLength(2);
    expect(llm.searchMoreResults[0]?.length).toBe(1);
    expect(llm.searchMoreResults[1]).toEqual([]);
  });

  it('searchMore results are numbered after the evidence', async () => {
    const { run, llm } = freshRig({
      llm: { searchMore: ['extra'] },
      search: { results: { '*': [HIT], extra: [EXTRA_HIT] } },
    });
    await run({ message: 'q' });
    const added = llm.searchMoreResults[0];
    expect(added?.[0]?.n).toBe(2);
  });

  it('statuses for tool searches reach the stream', async () => {
    const { run } = freshRig({ llm: { searchMore: ['extra one'] } });
    const events = await run({ message: 'q' });
    const statuses = events.filter((e) => e.type === 'status').map((e) => e.text);
    expect(statuses).toContain('Searching again: extra one');
  });

  it('extraction keeps only drafts whose quote is in the cited source', async () => {
    const { run, store } = freshRig({
      llm: {
        extractClaims: [
          { entity: 'Neon', attribute: 'price', value: '19 USD', scope: {}, quote: 'costs 19 USD per month', volatility: 'high', sourceN: 1 },
          { entity: 'Neon', attribute: 'price', value: '99 USD', scope: {}, quote: 'not on the page at all', volatility: 'high', sourceN: 1 },
        ],
      },
    });
    await run({ message: 'q' });
    const claims = store.allClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0]?.value).toBe('19 USD');
  });

  it('extraction drops drafts whose numbers are absent from the quote', async () => {
    const { run, store } = freshRig({
      llm: {
        extractClaims: [
          { entity: 'Neon', attribute: 'price', value: '42 USD', scope: {}, quote: 'costs 19 USD per month', volatility: 'high', sourceN: 1 },
        ],
      },
    });
    await run({ message: 'q' });
    expect(store.allClaims()).toHaveLength(0);
  });

  it('claim asOfUtc comes from the source fetch time, not the clock', async () => {
    const { run, store, clock } = freshRig({
      llm: {
        extractClaims: [
          { entity: 'Neon', attribute: 'price', value: '19 USD', scope: {}, quote: 'costs 19 USD per month', volatility: 'high', sourceN: 1 },
        ],
      },
    });
    clock.set('2030-01-01T00:00:00.000Z');
    const before = clock.now().toISOString();
    await run({ message: 'q' });
    const claim = store.allClaims()[0];
    expect(claim?.asOfUtc).toBe(before);
  });

  it('extraction failure marks the turn failed and the turn still completes', async () => {
    const { run, store } = freshRig({
      llm: { extractClaims: () => Promise.reject(new Error('extractor down')) },
    });
    const events = await run({ message: 'q' });
    expect(types(events).at(-1)).toBe('done');
    expect(lastAssistant(store)?.extraction).toBe('failed');
  });

  it('search failure produces a "search failed" answer and no claims; the writer is not called', async () => {
    const { run, store, llm } = rig({
      llm: { route: plan({ intent: 'fresh', queries: ['nothing'] }) },
      search: { results: {} },
    });
    const events = await run({ message: 'q' });
    expect(textOf(events)).toContain('Search failed');
    expect(llm.calls('write')).toHaveLength(0);
    expect(store.allClaims()).toHaveLength(0);
  });

  it('an empty queries list falls back to the user message as the query', async () => {
    const { run, search } = rig({
      llm: { route: plan({ intent: 'fresh', queries: [] }) },
      search: { results: { '*': [HIT] } },
    });
    await run({ message: 'my literal question' });
    expect(search.searchCalls[0]?.query).toBe('my literal question');
  });

  const HIT_B = { url: 'https://neon.test/b', title: 'B', publishedAt: null, text: 'Second page.' };
  const HIT_C = { url: 'https://neon.test/c', title: 'C', publishedAt: null, text: 'Third page.' };

  it('extraction sends only the cited evidence, with original numbers', async () => {
    const { run, llm } = freshRig({
      llm: { write: ['Launch is 19 USD [1], and the extra note holds [3].'] },
      search: { results: { '*': [HIT, HIT_B, HIT_C] } },
    });
    await run({ message: 'q' });
    const calls = llm.calls('extractClaims');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input.evidence.map((item) => item.n)).toEqual([1, 3]);
    expect(calls[0]?.input.evidence.map((item) => item.text)).toEqual([HIT.text, HIT_C.text]);
  });

  it('an answer with no citation makes no extractClaims call and marks extraction done', async () => {
    const { run, store, llm } = freshRig({
      llm: { write: ['A plain answer with no citations.'] },
    });
    await run({ message: 'q' });
    expect(llm.calls('extractClaims')).toHaveLength(0);
    expect(lastAssistant(store)?.extraction).toBe('done');
    expect(store.allClaims()).toHaveLength(0);
  });

  it('a draft citing an uncited source is not saved', async () => {
    const { run, store } = freshRig({
      llm: {
        write: ['Only the first source is cited [1].'],
        extractClaims: [
          { entity: 'Neon', attribute: 'price', value: '19 USD', scope: {}, quote: 'costs 19 USD per month', volatility: 'high', sourceN: 1 },
          { entity: 'Other', attribute: 'price', value: 'second', scope: {}, quote: 'Second page.', volatility: 'high', sourceN: 2 },
        ],
      },
      search: { results: { '*': [HIT, HIT_B] } },
    });
    await run({ message: 'q' });
    const claims = store.allClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0]?.entity).toBe('Neon');
  });

  it('extraction done is marked on the saved turn', async () => {
    const { run, store } = freshRig();
    await run({ message: 'q' });
    expect(lastAssistant(store)?.extraction).toBe('done');
  });
});
