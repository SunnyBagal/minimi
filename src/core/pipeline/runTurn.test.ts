import { describe, expect, it } from 'vitest';
import type { AgentDeps, AgentEvent, TurnInput } from '../contracts';
import { defaultConfig } from '../config';
import { chatPlan, FakeClock, FakeLlm, FakeSearch, fakeTime, passThroughGuard, type FakeLlmScript } from '../testing/fakes';
import { InMemoryStore } from '../testing/inMemoryStore';
import { runTurn } from './runTurn';

const NOW = '2026-11-10T20:00:00.000Z';

function makeDeps(script: FakeLlmScript = {}, store = new InMemoryStore()): { deps: AgentDeps; store: InMemoryStore; llm: FakeLlm; clock: FakeClock } {
  const clock = new FakeClock(NOW);
  const llm = new FakeLlm(script);
  const deps: AgentDeps = {
    clock,
    store,
    search: new FakeSearch(clock),
    llm,
    time: fakeTime(),
    guardVerdict: passThroughGuard,
    config: defaultConfig,
  };
  return { deps, store, llm, clock };
}

async function collect(input: TurnInput, deps: AgentDeps): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runTurn(input, deps)) events.push(event);
  return events;
}

const live = (overrides: Partial<TurnInput> = {}): TurnInput => ({
  sessionId: 's1',
  message: 'hello',
  tz: 'Asia/Kolkata',
  ...overrides,
});

describe('runTurn', () => {
  it('chat turn emits status, text…, done in order', async () => {
    const { deps, store } = makeDeps({ write: ['Hel', 'lo'] });
    const events = await collect(live(), deps);

    expect(events.map((event) => event.type)).toEqual(['status', 'text', 'text', 'done']);
    const deltas = events.filter((event) => event.type === 'text').map((event) => event.delta);
    expect(deltas.join('')).toBe('Hello');
    const done = events.at(-1);
    if (done === undefined || done.type !== 'done') throw new Error('last event is not done');
    expect(done.intent).toBe('chat');
    const assistant = store.allTurns().find((turn) => turn.role === 'assistant');
    expect(done.turnId).toBe(assistant?.id);
  });

  it('saves both turns', async () => {
    const { deps, store } = makeDeps({ write: ['hi'] });
    await collect(live({ message: 'remember me' }), deps);

    const turns = store.allTurns();
    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant']);
    expect(turns[0]?.content).toBe('remember me');
    expect(turns[1]?.content).toBe('hi');
    for (const turn of turns) {
      expect(turn.sessionId).toBe('s1');
      expect(turn.tz).toBe('Asia/Kolkata');
      expect(turn.localDate).toBe('2026-11-11');
      expect(turn.origin).toBe('live');
    }
    expect(turns[0]?.intent).toBeNull();
    expect(turns[1]?.intent).toBe('chat');
  });

  it('marks both turns origin seed when input.origin is seed', async () => {
    const { deps, store } = makeDeps();
    await collect(live({ origin: 'seed' }), deps);
    expect(store.allTurns().map((turn) => turn.origin)).toEqual(['seed', 'seed']);
  });

  it('recent never holds the current message', async () => {
    const { deps, store, llm } = makeDeps({ write: ['first answer'] });
    await collect(live({ message: 'first question' }), deps);

    const { deps: deps2, llm: llm2 } = makeDeps({ write: ['second answer'] }, store);
    await collect(live({ message: 'second question' }), deps2);

    const firstIds = store.allTurns().slice(0, 2).map((turn) => turn.id);
    const secondUserId = store.allTurns()[2]?.id;

    const routeRecent = llm2.calls('route')[0]?.input.recent ?? [];
    const writeCall = llm2.calls('write')[0]?.input;
    if (writeCall === undefined || writeCall.mode !== 'chat') throw new Error('write was not chat mode');
    const recentIds = (recent: typeof routeRecent) => recent.map((turn) => turn.id);
    expect(recentIds(routeRecent)).toEqual(firstIds);
    expect(recentIds(routeRecent)).not.toContain(secondUserId);
    expect(recentIds(writeCall.recent)).toEqual(firstIds);
    expect(writeCall.recent.map((turn) => turn.content)).not.toContain('second question');
    expect(llm.calls('route')[0]?.input.recent).toEqual([]);
  });

  it('a non-chat intent gives status, error, text, done', async () => {
    const { deps } = makeDeps({ route: chatPlan({ intent: 'fresh' }) });
    const events = await collect(live({ message: 'what is new?' }), deps);

    expect(events.map((event) => event.type)).toEqual(['status', 'error', 'text', 'done']);
    const done = events.at(-1);
    if (done === undefined || done.type !== 'done') throw new Error('last event is not done');
    expect(done.intent).toBe('fresh');
  });

  it('a writer error gives an error event then done', async () => {
    const { deps, store } = makeDeps({
      write: () => {
        async function* fail(): AsyncIterable<string> {
          throw new Error('model exploded');
        }
        return fail();
      },
    });
    const events = await collect(live(), deps);

    const tail = events.map((event) => event.type).slice(-2);
    expect(tail).toEqual(['error', 'done']);
    const error = events.find((event) => event.type === 'error');
    if (error === undefined || error.type !== 'error') throw new Error('no error event');
    expect(error.stage).toBe('write');
    const assistant = store.allTurns().find((turn) => turn.role === 'assistant');
    expect(assistant?.content).toBe('');
  });
});
