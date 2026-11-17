import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import type { AgentEvent } from '../src/core/contracts';
import { createStore } from '../src/core/store/index';
import { FakeClock } from '../src/core/testing/fakes';
import { literalAssertions, numbersAllowed } from './assert';
import type { CaseRun } from './types';

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

  it('fails both checks when the model writes a price that is in no evidence', () => {
    const run = runWith('What does it cost?', textEvents('The plan costs 19 USD.'));
    const scored = numbersAllowed(run, run.parts[0]?.traces[0]?.events ?? [], []);
    const strict = literalAssertions(run)[0];
    expect(scored.pass).toBe(false);
    expect(scored.observed).toEqual(['19']);
    expect(strict?.pass).toBe(false);
    expect(strict?.observed).toEqual(['19']);
  });
});
