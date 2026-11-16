import { describe, expect, it } from 'vitest';
import { guardVerdict } from './guards';
import { time } from '../time/index';
import { plan, rig, source, claim, textOf, types, userTurn, assistantTurn } from './testSupport';
import type { AgentEvent } from '../contracts';

// One test per intent, run with the real time functions and the real guard
// instead of fakeTime and passThroughGuard (allowed in test files only).
const REAL = { time, guard: guardVerdict };

const FRIDAY_NOON_IST = '2026-11-13T06:30:00.000Z'; // Fri 13 Nov 2026, 12:00 IST.

function verdicts(events: AgentEvent[]) {
  return events.filter((e) => e.type === 'verdict').map((e) => e.row);
}

describe('pipeline with the real time and guardVerdict', () => {
  it('chat', async () => {
    const { run } = rig({ ...REAL, now: FRIDAY_NOON_IST, llm: { write: ['Hello.'] } });
    const events = await run({ message: 'hi' });
    expect(types(events, ['timing'])).toEqual(['status', 'text', 'done']);
  });

  it('fresh', async () => {
    const { run, store } = rig({
      ...REAL,
      now: FRIDAY_NOON_IST,
      llm: {
        route: plan({ intent: 'fresh', queries: ['neon pricing'], entities: ['Neon'] }),
        write: ['19 USD [1].'],
        extractClaims: [],
      },
      search: { results: { '*': [{ url: 'https://neon.test/p', title: null, publishedAt: null, text: 'costs 19 USD' }] } },
    });
    const events = await run({ message: 'what does it cost?' });
    expect(types(events)).toContain('citations');
    expect(store.allTurns().find((turn) => turn.role === 'assistant')?.intent).toBe('fresh');
  });

  it('recall resolves "last Tuesday" through the real time functions', async () => {
    const { run, store } = rig({ ...REAL, now: FRIDAY_NOON_IST });
    userTurn(store, { content: 'Postgres hosting?', localDate: '2026-11-10', topic: 'Postgres' });
    const answer = assistantTurn(store, { localDate: '2026-11-10', topic: 'Postgres' });
    const src = source(store);
    claim(store, answer.id, src.id, { entity: 'Postgres', attribute: 'price' });
    const { run: run2, llm } = rig({
      ...REAL,
      now: FRIDAY_NOON_IST,
      store,
      llm: {
        route: plan({ intent: 'recall', timeRef: { kind: 'weekday', weekday: 2, modifier: 'last' }, topic: 'Postgres' }),
        write: ['ok'],
      },
    });
    const events = await run2({ message: 'last Tuesday I asked about Postgres' });
    const recalled = events.find((e) => e.type === 'recall');
    if (recalled === undefined || recalled.type !== 'recall') throw new Error('no recall');
    expect(recalled.chosen).toBe('2026-11-10');
    expect(textOf(events)).toContain('from memory, not re-checked');
    expect(llm.calls('route')).toHaveLength(1);
  });

  it('recheck with a live first-party page takes the fast path', async () => {
    const { run, store } = rig({ ...REAL, now: FRIDAY_NOON_IST });
    userTurn(store, { content: 'Neon price?', localDate: '2026-11-10' });
    const answer = assistantTurn(store, { localDate: '2026-11-10' });
    const src = source(store, { url: 'https://neon.test/pricing', firstParty: true });
    claim(store, answer.id, src.id, { entity: 'Neon', attribute: 'price', quote: 'costs 19 USD per month' });
    const { run: run2 } = rig({
      ...REAL,
      now: FRIDAY_NOON_IST,
      store,
      llm: {
        route: plan({ intent: 'recheck', refersToPrevious: true }),
        write: ['Summary [1].'],
      },
      search: { pages: { 'https://neon.test/pricing': { status: 'ok', live: true, text: 'It costs 19 USD per month.' } } },
    });
    const events = await run2({ message: 'is that still right?' });
    expect(verdicts(events)[0]?.check.decidedBy).toBe('fast_path');
  });

  it('recheck through the real guard downgrades a changed verdict with no quote on the page', async () => {
    const { run, store } = rig({ ...REAL, now: FRIDAY_NOON_IST });
    userTurn(store, { content: 'Neon price?', localDate: '2026-11-10' });
    const answer = assistantTurn(store, { localDate: '2026-11-10' });
    const src = source(store, { url: 'https://blog.test/review', firstParty: false });
    claim(store, answer.id, src.id, { entity: 'Neon', attribute: 'price', quote: 'costs 19 USD per month' });
    const { run: run2 } = rig({
      ...REAL,
      now: FRIDAY_NOON_IST,
      store,
      llm: {
        route: plan({ intent: 'recheck', refersToPrevious: true }),
        write: ['Summary.'],
        judge: () => ({
          verdict: 'changed',
          newValue: '24 USD/month',
          quote: 'this quote is not on the page',
          quoteUrl: 'https://blog.test/review',
          scope: {},
          reason: 'changed',
        }),
      },
      search: {
        pages: { 'https://blog.test/review': { status: 'ok', live: true, text: 'A review mentioning nothing useful.' } },
        results: {},
      },
    });
    const events = await run2({ message: 'is that still right?' });
    // The real guard turns a changed with an absent quote into unverifiable.
    expect(verdicts(events)[0]?.check.verdict).toBe('unverifiable');
  });

  it('no record on an empty store names the dates it tried', async () => {
    const { run } = rig({
      ...REAL,
      now: FRIDAY_NOON_IST,
      llm: {
        route: plan({ intent: 'recall', timeRef: { kind: 'weekday', weekday: 2, modifier: 'last' } }),
        write: ['I found nothing on 10 Nov or 3 Nov.'],
      },
    });
    const events = await run({ message: 'last Tuesday we talked Postgres' });
    const recalled = events.find((e) => e.type === 'recall');
    if (recalled === undefined || recalled.type !== 'recall') throw new Error('no recall');
    expect(recalled.chosen).toBeNull();
    expect(recalled.candidates.dates).toEqual(['2026-11-10', '2026-11-03']);
    expect(textOf(events)).toContain('nothing');
  });
});
