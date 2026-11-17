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

function runWith(message: string, events: AgentEvent[]): CaseRun {
  const dir = mkdtempSync(join(tmpdir(), 'minimi-eval-numbers-'));
  return {
    parts: [
      {
        traces: [{ message, events, answerText: '', log: [] }],
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
  it('passes the scored check and fails the strict one when the only extra numbers are a recall-line clock', () => {
    const answer = [
      'On Tue 10 Nov 2026, 14:05 GMT+5:30 you asked: "What does it cost?".',
      'The price is unchanged.',
    ].join('\n');
    const run = runWith('What does it cost?', textEvents(answer));
    const scored = numbersAllowed(run, run.parts[0]?.traces[0]?.events ?? [], []);
    const strict = literalAssertions(run)[0];
    expect(scored.pass).toBe(true);
    expect(scored.observed).toEqual([]);
    expect(strict?.pass).toBe(false);
    expect(strict?.observed).toEqual(['10', '2026', '14', '05', '5', '30']);
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
