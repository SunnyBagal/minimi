import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import type { AgentDeps } from '../src/core/contracts';
import { FakeClock, FakeLlm, FakeSearch, fakeTime, passThroughGuard } from '../src/core/testing/fakes';
import { InMemoryStore } from '../src/core/testing/inMemoryStore';
import { measure, median } from './measure';

function deps(llm: FakeLlm): AgentDeps {
  const clock = new FakeClock('2026-11-13T13:00:00.000Z');
  return {
    clock,
    store: new InMemoryStore(),
    search: new FakeSearch(clock),
    llm,
    time: fakeTime(),
    guardVerdict: passThroughGuard,
    config: defaultConfig,
  };
}

/** A script clock that moves 10 ms every time it is read. */
function steppingClock(): () => number {
  let t = 0;
  return () => {
    t += 10;
    return t;
  };
}

describe('median', () => {
  it('takes the middle value, the mean of the two middle values, and 0 for none', () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([40, 10, 30, 20])).toBe(25);
    expect(median([])).toBe(0);
  });
});

describe('measure', () => {
  it('records one turn per message per pass, each pass in a new session', async () => {
    const d = deps(new FakeLlm({ write: ['hello'] }));
    const result = await measure(d, { passes: 2, messages: ['a', 'b'], now: steppingClock() });

    expect(result.runs).toBe(4);
    expect(result.turns.map((turn) => [turn.pass, turn.message])).toEqual([
      [1, 'a'],
      [1, 'b'],
      [2, 'a'],
      [2, 'b'],
    ]);
    // Clock reads per turn: start, first text, done → 10 ms and 20 ms.
    for (const turn of result.turns) {
      expect(turn).toMatchObject({ intent: 'chat', firstTextMs: 10, totalMs: 20, verdicts: 0 });
    }
    expect(result.messages).toEqual([
      { message: 'a', medianFirstTextMs: 10, medianTotalMs: 20 },
      { message: 'b', medianFirstTextMs: 10, medianTotalMs: 20 },
    ]);
    // A new session per pass: the router never sees the other pass's turns.
    const recentLengths = (d.llm as FakeLlm).calls('route').map((call) => call.input.recent.length);
    expect(recentLengths).toEqual([0, 2, 0, 2]);
    expect(Object.keys(result.stages)).toContain('route');
    expect(result.stages.route?.ms).toHaveLength(4);
  });

  it('a turn that sends no text has firstTextMs null and the message median is null', async () => {
    const result = await measure(deps(new FakeLlm({ write: [] })), {
      passes: 1,
      messages: ['quiet'],
      now: steppingClock(),
    });
    expect(result.turns[0]).toMatchObject({ firstTextMs: null, totalMs: 10 });
    expect(result.messages[0]).toEqual({ message: 'quiet', medianFirstTextMs: null, medianTotalMs: 10 });
  });
});
