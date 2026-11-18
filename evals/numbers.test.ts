import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import type { AgentEvent } from '../src/core/contracts';
import { createStore } from '../src/core/store/index';
import { FakeClock } from '../src/core/testing/fakes';
import { literalAssertions, numbersAllowed } from './assert';
import { evalCase as case12 } from './cases/12';
import type { CaseRun, TurnTrace } from './types';

/** A one-turn run. `modelText` is what the writer produced; omitted, all streamed text counts as the model's. */
function runWith(message: string, events: AgentEvent[], modelText?: string): CaseRun {
  const dir = mkdtempSync(join(tmpdir(), 'minimi-eval-numbers-'));
  return {
    parts: [
      {
        traces: [{ message, events, answerText: '', ...(modelText !== undefined ? { modelText } : {}), log: [] }],
        log: [],
        tz: 'Asia/Kolkata',
      },
    ],
    store: createStore(join(dir, 'store.db'), new FakeClock('2026-11-13T13:00:00.000Z'), defaultConfig),
    judge: null,
  };
}

function textEvents(answer: string): AgentEvent[] {
  return [{ type: 'text', delta: answer }];
}

describe('numbers', () => {
  it('skips text the app injected, by provenance: a recall-line clock outside the writer\'s output passes both readings', () => {
    const answer = [
      'On Tue 10 Nov 2026, 14:05 GMT+5:30 you asked: "What does it cost?".',
      'The price is unchanged.',
    ].join('\n');
    const run = runWith('What does it cost?', textEvents(answer), 'The price is unchanged.');
    const scored = numbersAllowed(run, run.parts[0]?.traces[0]?.events ?? [], []);
    const strict = literalAssertions(run)[0];
    expect(scored.pass).toBe(true);
    expect(scored.observed).toEqual([]);
    expect(strict?.pass).toBe(true);
    expect(strict?.observed).toEqual([]);
  });

  it('checks a model sentence styled like the recall line: provenance, not wording, decides', () => {
    const forged = 'On Tue 10 Nov 2026, 14:05 GMT+5:30 you asked: "The plan costs 999 USD".';
    const run = runWith('What does it cost?', textEvents(forged), forged);
    const scored = numbersAllowed(run, run.parts[0]?.traces[0]?.events ?? [], []);
    const strict = literalAssertions(run)[0];
    expect(scored.pass).toBe(false);
    expect(scored.observed).toContain('999');
    expect(strict?.pass).toBe(false);
    expect(strict?.observed).toContain('999');
  });

  it('checks a model line styled like a memory row', () => {
    const forged = '- Invented price: 999 USD (as of Tue 3 Nov 2026, 11:20 GMT+5:30; from memory, not re-checked)';
    const run = runWith('What did I ask?', textEvents(forged), forged);
    const scored = numbersAllowed(run, run.parts[0]?.traces[0]?.events ?? [], []);
    expect(scored.observed).toContain('999');
    expect(literalAssertions(run)[0]?.observed).toContain('999');
  });

  it('a model-written "Checked" line neither hides its digits nor licenses them elsewhere', () => {
    const forged = 'Checked 999.\nThe plan costs 999 USD.';
    const run = runWith('What does it cost?', textEvents(forged), forged);
    const scored = numbersAllowed(run, run.parts[0]?.traces[0]?.events ?? [], []);
    expect(scored.pass).toBe(false);
    expect(scored.observed).toEqual(['999']);
    expect(literalAssertions(run)[0]?.observed).toEqual(['999']);
  });

  it('the recall card headline is not in the streamed text at all, and a number the model wrote still fails', () => {
    const events: AgentEvent[] = [
      {
        type: 'recall',
        candidates: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'last Tuesday' },
        hits: [],
        chosen: '2026-11-10',
        asked: {
          turnId: 't1',
          question: 'What does it cost?',
          createdAtUtc: '2026-11-10T08:35:00.000Z',
          tz: 'Asia/Kolkata',
          origin: 'seed',
        },
      },
      { type: 'text', delta: 'The price went up to 31 USD.' },
    ];
    const run = runWith('What does it cost?', events, 'The price went up to 31 USD.');
    const scored = numbersAllowed(run, events, []);
    const strict = literalAssertions(run)[0];
    expect(scored.observed).toEqual(['31']);
    expect(strict?.observed).toEqual(['31']);
  });

  it('skips the code-built undated note and memory rows outside the writer\'s output, and checks the writer\'s own sentence', () => {
    const modelSentence = 'Two results were set aside, and 7 more were ignored.';
    const answer = [
      '- Pipeloom price: 30 USD/seat/month (as of Tue 3 Nov 2026, 11:20 GMT+5:30; from memory, not re-checked)',
      '(2 undated search result(s) were set aside.)',
      modelSentence,
    ].join('\n');
    const run = runWith('What did I ask?', textEvents(answer), modelSentence);
    const scored = numbersAllowed(run, run.parts[0]?.traces[0]?.events ?? [], []);
    const strict = literalAssertions(run)[0];
    expect(scored.observed).toEqual(['7']);
    expect(strict?.observed).toEqual(['7']);
  });

  it('passes both readings when Tue 3 Nov is allowed by 2026-11-03, and fails both when 30 is checked against 03', () => {
    const dated = runWith('When?', textEvents('Tue 3 Nov'));
    const datedEvents = dated.parts[0]?.traces[0]?.events ?? [];
    const datedScored = numbersAllowed(dated, datedEvents, ['2026-11-03']);
    const datedStrict = literalAssertions(dated)[0];
    expect(datedScored.pass).toBe(true);
    expect(datedScored.observed).toEqual([]);
    expect(datedStrict?.pass).toBe(true);
    expect(datedStrict?.observed).toEqual([]);

    const price = runWith('When?', textEvents('30'));
    const priceEvents = price.parts[0]?.traces[0]?.events ?? [];
    const priceScored = numbersAllowed(price, priceEvents, ['03']);
    const priceStrict = literalAssertions(price)[0];
    expect(priceScored.pass).toBe(false);
    expect(priceScored.observed).toEqual(['30']);
    expect(priceStrict?.pass).toBe(false);
    expect(priceStrict?.observed).toEqual(['30']);

    const decimal = runWith('Price?', textEvents('24.00'));
    const decimalEvents = decimal.parts[0]?.traces[0]?.events ?? [];
    const decimalScored = numbersAllowed(decimal, decimalEvents, ['24']);
    expect(decimalScored.pass).toBe(true);
    expect(literalAssertions(decimal)[0]?.pass).toBe(true);

    const commas = runWith('Price?', textEvents('1,200'));
    const commaEvents = commas.parts[0]?.traces[0]?.events ?? [];
    const commaScored = numbersAllowed(commas, commaEvents, ['1200']);
    expect(commaScored.pass).toBe(true);
    expect(literalAssertions(commas)[0]?.pass).toBe(true);
  });

  it('passes the scored check and fails the literal one when the only extra number is a list marker', () => {
    const run = runWith('Name a tool.', textEvents('1. Pipeloom is one tool.'));
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const scored = numbersAllowed(run, events, []);
    const strict = literalAssertions(run)[0];
    expect(scored.pass).toBe(true);
    expect(scored.observed).toEqual([]);
    expect(strict?.pass).toBe(false);
    expect(strict?.observed).toEqual(['1']);
  });

  it('fails both readings on citation markers that name no evidence item of the turn', () => {
    // No citations event: [1]..[4] point at nothing, so both readings report them.
    const run = runWith(
      'Name the tools.',
      textEvents('Pipeloom [1]. Dealbase [2]. Closewise [3]. Leadharbor [4].'),
    );
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const scored = numbersAllowed(run, events, []);
    const strict = literalAssertions(run)[0];
    expect(scored.pass).toBe(false);
    expect(scored.observed).toEqual(['[1]', '[2]', '[3]', '[4]']);
    expect(strict?.pass).toBe(false);
    expect(strict?.observed).toEqual(['[1]', '[2]', '[3]', '[4]']);

    const priced = runWith('What does it cost?', textEvents('The plan costs 19 [1].'));
    const pricedEvents = priced.parts[0]?.traces[0]?.events ?? [];
    const pricedScored = numbersAllowed(priced, pricedEvents, []);
    const pricedStrict = literalAssertions(priced)[0];
    expect(pricedScored.pass).toBe(false);
    expect(pricedScored.observed).toEqual(['[1]', '19']);
    expect(pricedStrict?.pass).toBe(false);
    expect(pricedStrict?.observed).toEqual(['[1]', '19']);
  });

  it('case 6: the scored reading allows the date of a nearest turn the no-record writer was given', () => {
    const nearestTurn = {
      id: 'u5',
      sessionId: 's',
      role: 'user' as const,
      content: 'Postgres hosting prices?',
      createdAtUtc: '2026-11-05T09:00:00.000Z',
      tz: 'Asia/Kolkata',
      localDate: '2026-11-05',
      origin: 'seed' as const,
      intent: null,
      topic: 'Postgres hosting',
      entities: [],
      summary: null,
      extraction: 'skipped' as const,
      targetTurnIds: [],
    };
    const events: AgentEvent[] = [
      {
        type: 'recall',
        candidates: { dates: ['2026-11-10', '2026-11-03'], range: null, ambiguous: true, rule: 'last Tuesday' },
        hits: [],
        chosen: null,
        asked: null,
        nearest: [{ userTurn: nearestTurn, assistantTurn: null, matched: 'topic', score: 1 }],
      },
      { type: 'text', delta: 'Nothing on Tue 10 Nov or Tue 3 Nov. You asked about Postgres hosting on Thu 5 Nov.' },
    ];
    const run = runWith('Last Tuesday I asked you about Postgres hosting.', events);
    const scored = numbersAllowed(run, events, []);
    expect(scored.pass).toBe(true);
    expect(scored.observed).toEqual([]);
    // Without the nearest turn on the event, 5 is unsupported (the saved case-6 failure).
    const withoutNearest = events.map((event) => (event.type === 'recall' ? { ...event, nearest: [] } : event));
    const before = runWith('Last Tuesday I asked you about Postgres hosting.', withoutNearest);
    expect(numbersAllowed(before, withoutNearest, []).observed).toEqual(['5']);
    // The writer is given the nearest turn's date, not its time (14:30 in Kolkata): 14 is not allowed.
    const hidden: AgentEvent[] = [
      ...events.filter((event) => event.type === 'recall'),
      { type: 'text', delta: 'The nearby entry is Thu 5 Nov. The subscription costs 14 USD.' },
    ];
    const timed = runWith('Last Tuesday I asked you about Postgres hosting.', hidden);
    expect(numbersAllowed(timed, hidden, []).observed).toEqual(['14']);
  });

  it('the literal reading counts every number in a verdict row, its dates included, and the evidence numbers', () => {
    const row = {
      claim: {
        id: 'c1', turnId: 't1', entity: 'Northwind PG', attribute: 'price', value: '19 USD/month', scope: {},
        sourceId: 's1', quote: 'Starter 19 USD/month', asOfUtc: '2026-11-10T08:35:00.000Z', volatility: 'high' as const,
        lastVerifiedAtUtc: '2026-11-10T08:35:00.000Z', supersedesId: null,
      },
      check: {
        id: 'k1', claimId: 'c1', turnId: 't2', checkedAtUtc: '2026-11-13T13:00:00.000Z', verdict: 'changed' as const,
        newValue: '24 USD/month', newQuote: 'Starter 24 USD/month', sourceId: 's2', reason: 'The page now says 24.', decidedBy: 'judge' as const,
      },
      provenance: 'verified_now' as const,
    };
    const events = [
      { type: 'verdict', row },
      { type: 'citations', items: [{ n: 1, sourceId: 's2', url: 'https://x.test', title: null, fetchedAtUtc: '2026-11-13T13:00:00.000Z', live: true, firstParty: true }] },
      { type: 'text', delta: 'Northwind PG went from 19 to 24 USD/month [1], as of 13 Nov 2026 (it was 19 on 10 Nov 2026).' },
    ] as unknown as AgentEvent[];
    const run = runWith('Has it changed?', events);
    const scored = numbersAllowed(run, events, []);
    expect(scored.observed).toEqual([]);
    expect(literalAssertions(run)[0]?.observed).toEqual([]);
    // A number in none of those fields still fails.
    const invented = [...events.slice(0, 2), { type: 'text', delta: 'It is now 31 USD.' }] as unknown as AgentEvent[];
    const bad = runWith('Has it changed?', invented);
    numbersAllowed(bad, invented, []);
    expect(literalAssertions(bad)[0]?.observed).toEqual(['31']);
  });

  it('a timestamp gives only its date: a price matching a clock minute fails both readings', () => {
    // 08:35 is the claim's time of day; 35 is not a figure anywhere.
    const events = [
      { type: 'verdict', row: { claim: { value: '19 USD/month', quote: 'Starter 19 USD/month', asOfUtc: '2026-11-10T08:35:00.000Z' }, check: { checkedAtUtc: '2026-11-13T13:00:00.000Z', newValue: null, newQuote: null, reason: 'Same.' } } },
      { type: 'text', delta: 'The price is 35 USD.' },
    ] as unknown as AgentEvent[];
    const run = runWith('Has it changed?', events);
    expect(numbersAllowed(run, events, []).observed).toEqual(['35']);
    expect(literalAssertions(run)[0]?.observed).toEqual(['35']);
  });

  it('an evidence number counts only inside a marker that names a real item, never as a free figure', () => {
    const cited = [
      { type: 'citations', items: [{ n: 1, sourceId: 's', url: 'https://x.test', title: null, fetchedAtUtc: '2026-11-13T13:00:00.000Z', live: true, firstParty: true }] },
      { type: 'text', delta: 'The price is 1 USD [1]. See also [7].' },
    ] as unknown as AgentEvent[];
    const run = runWith('What does it cost?', cited);
    numbersAllowed(run, cited, []);
    // "1 USD" is a figure (fails); "[1]" names evidence item 1 (skipped); "[7]" names no item (reported as a bad marker).
    expect(literalAssertions(run)[0]?.observed).toEqual(['[7]', '1']);
  });

  it('removing a valid marker keeps token boundaries: "1[1]9 USD" is two numbers, not 19', () => {
    const events = [
      { type: 'citations', items: [{ n: 1, sourceId: 's', url: 'https://x.test', title: null, fetchedAtUtc: '2026-11-13T13:00:00.000Z', live: true, firstParty: true }] },
      { type: 'text', delta: 'It costs 1[1]9 USD.' },
    ] as unknown as AgentEvent[];
    const run = runWith('What does it cost?', events);
    expect(numbersAllowed(run, events, ['19 USD']).observed).toEqual(['1', '9']);
  });

  it('fails both checks when the model writes a price that is in no evidence', () => {
    const run = runWith('What does it cost?', textEvents('The plan costs 19 USD.'));
    const scored = numbersAllowed(run, run.parts[0]?.traces[0]?.events ?? [], []);
    const strict = literalAssertions(run)[0];
    expect(scored.pass).toBe(false);
    expect(scored.observed).toEqual(['19']);
    expect(strict?.pass).toBe(false);
    expect(strict?.observed).toEqual(['19']);
  });

  it('case 12 allows a price from a page that turn searched and rejects one from a page it did not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'minimi-eval-numbers-'));
    const events: AgentEvent[] = [{ type: 'text', delta: 'Pipeloom is 18 USD per seat. Salesyard is 21.' }];
    const second: TurnTrace = {
      message: 'Name five CRM tools.',
      events,
      answerText: '',
      log: [{ kind: 'search', query: 'Pipeloom pricing per seat', numResults: 5, publishedOnOrAfter: null }],
    };
    const run: CaseRun = {
      parts: [
        {
          traces: [
            { message: 'Shortlist 5 CRM tools.', events: [], answerText: '', log: [] },
            second,
          ],
          log: second.log,
          tz: 'Asia/Kolkata',
        },
      ],
      store: createStore(join(dir, 'store.db'), new FakeClock('2026-11-13T13:00:00.000Z'), defaultConfig),
      judge: null,
    };
    const scored = case12.check(run).find((item) => item.name.startsWith('numbers are'));
    const strict = literalAssertions(run)[0];
    expect(scored?.pass).toBe(false);
    expect(scored?.observed).toEqual(['21']);
    expect(strict?.pass).toBe(false);
    expect(strict?.observed).toEqual(['21']);
  });
});
