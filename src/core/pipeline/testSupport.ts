/**
 * Builders shared by the pipeline tests: a deps bundle on the fakes, canned
 * turns/claims/sources seeded straight into an InMemoryStore, and a collector
 * that drains a runTurn stream into an event list.
 */
import type {
  AgentConfig,
  AgentDeps,
  AgentEvent,
  Claim,
  LocalDate,
  MemoryStore,
  NewClaim,
  NewSource,
  NewTurn,
  RouterPlan,
  Source,
  Turn,
  TurnInput,
} from '../contracts';
import { defaultConfig } from '../config';
import { chatPlan, FakeClock, FakeLlm, FakeSearch, fakeTime, passThroughGuard, type FakeLlmScript, type FakeSearchScript, type FakeTimeRow } from '../testing/fakes';
import { InMemoryStore } from '../testing/inMemoryStore';
import { runTurn } from './runTurn';

export const SESSION = 'session-test';
export const TZ = 'Asia/Kolkata';
export const NOW = '2026-11-16T04:30:00.000Z'; // Mon 16 Nov 2026, 10:00 IST.

export function config(overrides: Partial<AgentConfig['limits']> = {}, deadlines: Partial<AgentConfig['deadlinesMs']> = {}): AgentConfig {
  return {
    ...defaultConfig,
    limits: { ...defaultConfig.limits, ...overrides },
    deadlinesMs: { ...defaultConfig.deadlinesMs, ...deadlines },
  };
}

export interface Rig {
  deps: AgentDeps;
  clock: FakeClock;
  store: InMemoryStore;
  search: FakeSearch;
  llm: FakeLlm;
  run(input: Partial<TurnInput> & { message: string }): Promise<AgentEvent[]>;
}

/** Deps on the fakes; `run` drains the turn stream into an event array. */
export function rig(options: {
  now?: string;
  llm?: FakeLlmScript;
  search?: FakeSearchScript;
  timeTable?: FakeTimeRow[];
  limits?: Partial<AgentConfig['limits']>;
  deadlines?: Partial<AgentConfig['deadlinesMs']>;
  store?: InMemoryStore;
  time?: AgentDeps['time'];
  guard?: AgentDeps['guardVerdict'];
  llmInstance?: FakeLlm;
}): Rig {
  const clock = new FakeClock(options.now ?? NOW);
  const store = options.store ?? new InMemoryStore();
  const search = new FakeSearch(clock, options.search ?? {});
  const llm = options.llmInstance ?? new FakeLlm(options.llm ?? {});
  const deps: AgentDeps = {
    clock,
    store,
    search,
    llm,
    time: options.time ?? fakeTime(options.timeTable ?? []),
    guardVerdict: options.guard ?? passThroughGuard,
    config: config(options.limits, options.deadlines),
  };
  const run = async (input: Partial<TurnInput> & { message: string }): Promise<AgentEvent[]> => {
    const events: AgentEvent[] = [];
    for await (const event of runTurn({ sessionId: SESSION, tz: TZ, ...input }, deps)) {
      events.push(event);
    }
    return events;
  };
  return { deps, clock, store, search, llm, run };
}

// ------------------------------------------------------------------ builders

export function userTurn(store: InMemoryStore, fields: Partial<NewTurn> & { content: string }): Turn {
  return store.saveTurn({
    sessionId: SESSION,
    role: 'user',
    createdAtUtc: '2026-11-09T05:00:00.000Z',
    tz: TZ,
    localDate: '2026-11-09',
    origin: 'live',
    topic: null,
    entities: [],
    summary: null,
    extraction: 'skipped',
    intent: null,
    targetTurnIds: [],
    ...fields,
  });
}

export function assistantTurn(store: InMemoryStore, fields: Partial<NewTurn> = {}): Turn {
  return store.saveTurn({
    sessionId: SESSION,
    role: 'assistant',
    content: 'A stored answer.',
    createdAtUtc: '2026-11-09T05:05:00.000Z',
    tz: TZ,
    localDate: '2026-11-09',
    origin: 'live',
    topic: null,
    entities: [],
    summary: null,
    extraction: 'done',
    intent: 'fresh',
    targetTurnIds: [],
    ...fields,
  });
}

export function source(store: InMemoryStore, fields: Partial<NewSource> = {}): Source {
  return store.saveSource({
    url: 'https://example.test/page',
    finalUrl: 'https://example.test/page',
    title: null,
    publishedAt: null,
    fetchedAtUtc: '2026-11-09T05:05:00.000Z',
    live: false,
    firstParty: false,
    httpStatus: 200,
    text: '',
    ...fields,
  });
}

export function claim(store: InMemoryStore, turnId: string, sourceId: string, fields: Partial<NewClaim> = {}): Claim {
  const saved = store.saveClaims([
    {
      turnId,
      entity: 'Example Co',
      attribute: 'price',
      value: '10 USD/month',
      scope: {},
      sourceId,
      quote: 'Example Co costs 10 USD per month.',
      asOfUtc: '2026-11-09T05:05:00.000Z',
      volatility: 'high',
      lastVerifiedAtUtc: '2026-11-09T05:05:00.000Z',
      supersedesId: null,
      ...fields,
    },
  ]);
  return saved[0] as Claim;
}

/** A plan for route scripts: chatPlan with the given overrides. */
export function plan(overrides: Partial<RouterPlan>): RouterPlan {
  return chatPlan(overrides);
}

/** Event types in order, optionally excluding transient ones. */
export function types(events: AgentEvent[], without: AgentEvent['type'][] = []): string[] {
  return events.filter((event) => !without.includes(event.type)).map((event) => event.type);
}

/** The joined text deltas a turn emitted. */
export function textOf(events: AgentEvent[]): string {
  return events.filter((e) => e.type === 'text').map((e) => e.delta).join('');
}

export function lastAssistant(store: InMemoryStore): Turn | undefined {
  return store.allTurns().findLast((turn) => turn.role === 'assistant');
}

export type { LocalDate, MemoryStore };
